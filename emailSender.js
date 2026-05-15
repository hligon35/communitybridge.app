import { readFile } from 'node:fs/promises';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function assetToBase64(assetPath) {
  const buffer = await readFile(new URL(assetPath, import.meta.url));
  return buffer.toString('base64');
}

async function sendEmail() {
  const [titleLogoContent, footerLogoContent] = await Promise.all([
    assetToBase64('./assets/titlelogo2.png'),
    assetToBase64('./assets/logo.png'),
  ]);

  const result = await resend.emails.send({
    from: 'CommunityBridge <hligon@communitybridge.app>',
    to: 'cassandra.solan@centria-healthcare.com',
    subject: 'CommunityBridge App for Review',
    attachments: [
      {
        filename: 'titlelogo2.png',
        content: titleLogoContent,
        contentType: 'image/png',
        contentId: 'titlelogo',
      },
      {
        filename: 'logo.png',
        content: footerLogoContent,
        contentType: 'image/png',
        contentId: 'footerlogo',
      },
    ],
    html: `
      <div style="margin:0;padding:0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#334155;">
        <div style="max-width:680px;margin:0 auto;">
          <div style="background:linear-gradient(315deg,#0f172a 0%,#1d4ed8 72%,#60a5fa 100%);padding:32px 24px 28px;color:#ffffff;">
            <img src="cid:titlelogo" alt="CommunityBridge" width="220" style="display:block;width:220px;max-width:100%;height:auto;margin:0 auto 10px;" />
            <p style="margin:0;font-size:16px;line-height:1.7;color:rgba(255,255,255,0.88);max-width:560px;">
              Role-based operations, communication, and care-team coordination in one place.
            </p>
          </div>

          <div style="padding:28px 24px 0;background-color:#ffffff;">
            <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">
              Good afternoon Cassandra,
            </p>

            <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">
              I hope you're doing well. I don't know if Vicky has mentioned it, but I have been working on an app for Centria to use.
            </p>

            <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">
              I built CommunityBridge as a role-based platform designed to support core operational and care-team workflows across families, therapists, BCBAs, and administrative staff. The goal is to bring communication, scheduling, family coordination, alerts, and related workflows into one system that can be adapted to an organization's needs.
            </p>

            <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">
              I'd appreciate the opportunity to have you review it and share your perspective, particularly on the BCBA, ABA, and admin workflows. Your feedback on overall usefulness, workflow fit, and what would need to be improved for real-world adoption would be especially valuable.
            </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#334155;">
                To make review easier, I included separate demo accounts for the BCBA, ABA, and admin roles so you can see each workflow as it would appear in normal use.
              </p>

            <p style="margin:0 0 24px;font-size:16px;line-height:1.8;color:#334155;">
              If there are any issues, additions, or improvements you would want to see, I can implement them promptly.
            </p>

            <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:10px;">
              <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;margin-bottom:14px;">
                Access Details
              </div>

              <div style="margin-bottom:12px;padding:14px 16px;border-radius:14px;background-color:#ffffff;border:1px solid #dbeafe;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">
                  TestFlight
                </div>
                <a href="https://testflight.apple.com/join/K6AHCVW9" style="font-size:16px;font-weight:700;color:#1d4ed8;text-decoration:none;">
                  Click to open CommunityBridge in TestFlight
                </a>
              </div>

              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
                <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:14px; margin-bottom:4px;">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">BCBA</div>
                  <div style="font-size:14px;line-height:1.7;color:#334155;">
                    <strong style="color:#0f172a;">Login:</strong> bcba@communitybridge.app<br />
                    <strong style="color:#0f172a;">Password:</strong> BcbaDemo123!
                  </div>
                </div>

                <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:14px; margin-bottom:4px;">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">ABA</div>
                  <div style="font-size:14px;line-height:1.7;color:#334155;">
                    <strong style="color:#0f172a;">Login:</strong> aba@communitybridge.app<br />
                    <strong style="color:#0f172a;">Password:</strong> AbaTech123!
                  </div>
                </div>

                <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:14px; margin-bottom:4px;">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">Admin</div>
                  <div style="font-size:14px;line-height:1.7;color:#334155;">
                    <strong style="color:#0f172a;">Login:</strong> admin@communitybridge.app<br />
                    <strong style="color:#0f172a;">Password:</strong> AdminDemo123!
                  </div>
                </div>
              </div>
            </div>

            <p style="margin:24px 0 0;font-size:16px;line-height:1.8;color:#334155;">
              If it would be more helpful, I would also be glad to walk you through it live.
            </p>

            <p style="margin:24px 0 0;font-size:16px;line-height:1.8;color:#334155;">
              Thanks for your time,
            </p>
          </div>

          <div style="padding:18px 24px 0 4px;color:#64748b;font-size:14px;line-height:1.8;background-color:#ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:0 8px 0 0;vertical-align:middle;">
                  <img src="cid:footerlogo" alt="CommunityBridge logo" width="100" height="100" style="display:block;width:100px;height:100px;border-radius:12px;" />
                </td>
                <td style="vertical-align:middle;">
                  <strong style="display:block;color:#0f172a;font-size:16px;">Harold Ligon</strong>
                  (317) 432-3276<br />
                  <a href="mailto:hligon@communitybridge.app" style="color:#1d4ed8;text-decoration:none;">hligon@communitybridge.app</a>
                </td>
              </tr>
            </table>
          </div>
        </div>
      </div>
    `,
  });

  console.log(result);
}

sendEmail().catch(console.error);