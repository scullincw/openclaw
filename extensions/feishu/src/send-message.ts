import { withDiagnosticSpan } from "../../../src/infra/diagnostic-trace.js";
import { assertFeishuMessageApiSuccess, toFeishuSendResult } from "./send-result.js";

type FeishuMessageClient = {
  im: {
    message: {
      reply: (params: {
        path: { message_id: string };
        data: Record<string, unknown>;
      }) => Promise<{ code?: number; msg?: string; data?: { message_id?: string } }>;
      create: (params: {
        params: { receive_id_type: string };
        data: Record<string, unknown>;
      }) => Promise<{ code?: number; msg?: string; data?: { message_id?: string } }>;
    };
  };
};

export async function sendFeishuMessageWithOptionalReply(params: {
  client: FeishuMessageClient;
  receiveId: string;
  receiveIdType: string;
  content: string;
  msgType: string;
  replyToMessageId?: string;
  replyInThread?: boolean;
  sendErrorPrefix: string;
  replyErrorPrefix: string;
  fallbackSendErrorPrefix?: string;
  shouldFallbackFromReply?: (response: { code?: number; msg?: string }) => boolean;
}): Promise<{ messageId: string; chatId: string }> {
  return await withDiagnosticSpan(
    "feishu.outbound.send",
    {
      receive_id_type: params.receiveIdType,
      msg_type: params.msgType,
      is_reply: Boolean(params.replyToMessageId),
      reply_in_thread: params.replyInThread === true,
    },
    async () => {
      const data = {
        content: params.content,
        msg_type: params.msgType,
      };

      if (params.replyToMessageId) {
        const replyToMessageId = params.replyToMessageId;
        return await withDiagnosticSpan(
          "feishu.outbound.reply",
          {
            reply_to_message_id: replyToMessageId,
            reply_in_thread: params.replyInThread === true,
          },
          async () => {
            const response = await params.client.im.message.reply({
              path: { message_id: replyToMessageId },
              data: {
                ...data,
                ...(params.replyInThread ? { reply_in_thread: true } : {}),
              },
            });
            if (params.shouldFallbackFromReply?.(response)) {
              return await withDiagnosticSpan(
                "feishu.outbound.reply_fallback",
                {
                  receive_id_type: params.receiveIdType,
                },
                async () => {
                  const fallback = await params.client.im.message.create({
                    params: { receive_id_type: params.receiveIdType },
                    data: {
                      receive_id: params.receiveId,
                      ...data,
                    },
                  });
                  return await withDiagnosticSpan(
                    "feishu.outbound.ack",
                    {
                      method: "create_fallback",
                      code: fallback.code ?? -1,
                    },
                    async () => {
                      assertFeishuMessageApiSuccess(
                        fallback,
                        params.fallbackSendErrorPrefix ?? params.sendErrorPrefix,
                      );
                      return toFeishuSendResult(fallback, params.receiveId);
                    },
                  );
                },
              );
            }
            return await withDiagnosticSpan(
              "feishu.outbound.ack",
              {
                method: "reply",
                code: response.code ?? -1,
              },
              async () => {
                assertFeishuMessageApiSuccess(response, params.replyErrorPrefix);
                return toFeishuSendResult(response, params.receiveId);
              },
            );
          },
        );
      }

      return await withDiagnosticSpan(
        "feishu.outbound.create",
        {
          receive_id_type: params.receiveIdType,
        },
        async () => {
          const response = await params.client.im.message.create({
            params: { receive_id_type: params.receiveIdType },
            data: {
              receive_id: params.receiveId,
              ...data,
            },
          });
          return await withDiagnosticSpan(
            "feishu.outbound.ack",
            {
              method: "create",
              code: response.code ?? -1,
            },
            async () => {
              assertFeishuMessageApiSuccess(response, params.sendErrorPrefix);
              return toFeishuSendResult(response, params.receiveId);
            },
          );
        },
      );
    },
  );
}
