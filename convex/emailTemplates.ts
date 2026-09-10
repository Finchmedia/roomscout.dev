export type NewMessageEmailInput = {
  counterpartyLabel: string;
  listingTitle: string;
  threadUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function newMessageEmail(input: NewMessageEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const counterpartyLabel = escapeHtml(input.counterpartyLabel);
  const listingTitle = escapeHtml(input.listingTitle);
  const threadUrl = escapeHtml(input.threadUrl);
  const subject = `New message about ${input.listingTitle}`.slice(0, 180);

  return {
    subject,
    text: [
      "You have a new RoomScout Community message.",
      "",
      `${input.counterpartyLabel} sent a message about “${input.listingTitle}”.`,
      "Sign in to read and reply:",
      input.threadUrl,
      "",
      "The message itself is intentionally not copied into this notification.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>You have a new message</title>
  </head>
  <body style="margin:0;background:#0b0b0a;color:#f6f3ee;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A new RoomScout Community message is waiting.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #45413b;border-radius:18px;background:#151411;overflow:hidden;">
            <tr>
              <td style="padding:20px 28px;border-bottom:1px solid #34312d;color:#ff6a2a;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">roomscout community</td>
            </tr>
            <tr>
              <td style="padding:34px 28px 18px;">
                <h1 style="margin:0 0 18px;font-size:30px;line-height:1.15;color:#ffffff;">You have a new message</h1>
                <p style="margin:0 0 10px;font-size:17px;line-height:1.55;color:#ddd8d1;"><strong style="color:#ffffff;">${counterpartyLabel}</strong> sent a message about:</p>
                <p style="margin:0 0 26px;font-size:19px;line-height:1.45;color:#ffffff;">${listingTitle}</p>
                <a href="${threadUrl}" style="display:inline-block;border-radius:10px;background:#ff6426;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 20px;">Open conversation</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 28px;color:#918b83;font-size:13px;line-height:1.5;">The message content stays inside the authenticated portal. Sign in to read it and reply.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
