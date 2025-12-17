import { logger } from "../utils/logger";
import type { DetectionSettings, Order } from "@shared/schema";
import { subscriptionService } from "./subscription.service";
import nodemailer from "nodemailer";

interface NotificationData {
  order: Order;
  duplicateOf: Order;
  confidence: number;
  matchReason: string;
}

export class NotificationService {
  /**
   * Send notifications when a duplicate order is detected
   */
  async sendNotifications(
    shopDomain: string,
    settings: DetectionSettings,
    data: NotificationData
  ): Promise<void> {
    // Check if subscription allows notifications (Paid tier only)
    try {
      const subscription = await subscriptionService.getSubscription(shopDomain);
      if (subscription?.tier !== "paid") {
        logger.debug("[Notification] Free tier subscription, skipping notifications (Premium feature)");
        return;
      }
    } catch (error) {
      logger.error("[Notification] Failed to check subscription status:", error);
      // Fail safe: don't send if we can't verify subscription
      return;
    }

    // Check if notifications are enabled
    if (!settings.enableNotifications) {
      logger.debug("[Notification] Notifications disabled, skipping");
      return;
    }

    // Check if confidence meets threshold
    if (data.confidence < settings.notificationThreshold) {
      logger.debug(
        `[Notification] Confidence ${data.confidence}% below threshold ${settings.notificationThreshold}%, skipping`
      );
      return;
    }

    const promises: Promise<void>[] = [];

    // Send email notification if configured
    if (settings.notificationEmail) {
      promises.push(
        this.sendEmailNotification(shopDomain, settings.notificationEmail, data)
      );
    }

    // Send Slack notification if configured
    if (settings.slackWebhookUrl) {
      promises.push(this.sendSlackNotification(shopDomain, settings.slackWebhookUrl, data));
    }

    // Wait for all notifications to complete (don't fail if one fails)
    await Promise.allSettled(promises);
  }

  /**
   * Send email notification via SMTP
   */
  private async sendEmailNotification(
    shopDomain: string,
    email: string,
    data: NotificationData
  ): Promise<void> {
    try {
      // Use environment variables for SMTP configuration
      const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587");
      const smtpUser = process.env.SMTP_USER;
      const smtpPassword = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || smtpUser;

      if (!smtpUser || !smtpPassword) {
        logger.warn(
          "[Notification] SMTP credentials not configured, skipping email notification"
        );
        return;
      }

      const emailBody = this.formatEmailBody(shopDomain, data);
      const subject = `Duplicate Order Detected: ${data.order.orderNumber}`;

      // Create nodemailer transporter
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      // Generate HTML email
      const emailHtml = this.formatEmailHtml(shopDomain, data);

      // Send email with both HTML and plain text
      const info = await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: subject,
        text: emailBody,
        html: emailHtml,
      });

      logger.info(`[Notification] Successfully sent email to ${email}`, {
        messageId: info.messageId,
        subject,
      });
    } catch (error) {
      logger.error("[Notification] Failed to send email notification:", error);
      // Don't throw - allow other notifications to proceed
    }
  }

  /**
   * Send Slack notification via webhook
   */
  private async sendSlackNotification(
    shopDomain: string,
    webhookUrl: string,
    data: NotificationData
  ): Promise<void> {
    try {
      const slackMessage = this.formatSlackMessage(shopDomain, data);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Slack API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      logger.info("[Notification] Successfully sent Slack notification");
    } catch (error) {
      logger.error("[Notification] Failed to send Slack notification:", error);
      // Don't throw - allow other notifications to proceed
    }
  }

  /**
   * Format email body
   */
  private formatEmailBody(shopDomain: string, data: NotificationData): string {
    const orderUrl = `https://${shopDomain}/admin/orders/${data.order.shopifyOrderId}`;
    
    return `
Duplicate Order Detected

Order Details:
- Order Number: ${data.order.orderNumber}
- Customer: ${data.order.customerName || "Unknown"} (${
      data.order.customerEmail
    })
- Total: ${data.order.currency} ${data.order.totalPrice}
- Created: ${new Date(data.order.createdAt).toLocaleString()}
- View in Shopify: ${orderUrl}

Duplicate Match:
- Matched Order: ${data.duplicateOf.orderNumber}
- Confidence: ${data.confidence}%
- Reason: ${data.matchReason}

Please review these orders in your Shopify admin.
    `.trim();
  }

  /**
   * Format HTML email body with professional styling
   */
  private formatEmailHtml(shopDomain: string, data: NotificationData): string {
    const orderUrl = `https://${shopDomain}/admin/orders/${data.order.shopifyOrderId}`;
    const matchOrderUrl = `https://${shopDomain}/admin/orders/${data.duplicateOf.shopifyOrderId}`;
    
    // Determine confidence level and color
    const confidenceLevel = data.confidence >= 85 ? 'high' : data.confidence >= 70 ? 'medium' : 'low';
    const confidenceColor = confidenceLevel === 'high' ? '#dc2626' : confidenceLevel === 'medium' ? '#f59e0b' : '#22c55e';
    const confidenceBgColor = confidenceLevel === 'high' ? '#fef2f2' : confidenceLevel === 'medium' ? '#fffbeb' : '#f0fdf4';
    const confidenceLabel = confidenceLevel === 'high' ? 'High Risk' : confidenceLevel === 'medium' ? 'Medium Risk' : 'Low Risk';
    
    // Format dates
    const orderDate = new Date(data.order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const matchDate = new Date(data.duplicateOf.createdAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Duplicate Order Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                🚨 Duplicate Order Detected
              </h1>
              <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">
                Order Auditor Alert for ${shopDomain}
              </p>
            </td>
          </tr>
          
          <!-- Confidence Badge -->
          <tr>
            <td style="padding: 24px 40px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: ${confidenceBgColor}; border: 2px solid ${confidenceColor}; border-radius: 8px; padding: 16px; text-align: center;">
                    <span style="font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Confidence Score</span>
                    <div style="margin: 8px 0;">
                      <span style="font-size: 36px; font-weight: 700; color: ${confidenceColor};">${data.confidence}%</span>
                    </div>
                    <span style="display: inline-block; background-color: ${confidenceColor}; color: #ffffff; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; text-transform: uppercase;">
                      ${confidenceLabel}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Match Reason -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: #f8fafc; border-radius: 8px; padding: 12px 16px; text-align: center;">
                    <span style="font-size: 13px; color: #64748b;">Match Reason: </span>
                    <span style="font-size: 13px; color: #1e293b; font-weight: 600;">${data.matchReason}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Order Comparison -->
          <tr>
            <td style="padding: 0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td width="50%" style="background-color: #fef2f2; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                    <span style="font-size: 11px; color: #dc2626; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">⚠️ Flagged Order</span>
                  </td>
                  <td width="50%" style="background-color: #f0f9ff; padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-size: 11px; color: #0369a1; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">🔗 Matches With</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px; border-right: 1px solid #e2e8f0; vertical-align: top;">
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Order Number</span>
                      <span style="font-size: 16px; color: #1e293b; font-weight: 600;">${data.order.orderNumber}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Customer</span>
                      <span style="font-size: 14px; color: #1e293b;">${data.order.customerName || 'Unknown'}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Email</span>
                      <span style="font-size: 14px; color: #1e293b;">${data.order.customerEmail}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Total</span>
                      <span style="font-size: 16px; color: #1e293b; font-weight: 600;">${data.order.currency} ${data.order.totalPrice}</span>
                    </div>
                    <div>
                      <span style="font-size: 12px; color: #64748b; display: block;">Created</span>
                      <span style="font-size: 13px; color: #64748b;">${orderDate}</span>
                    </div>
                  </td>
                  <td style="padding: 16px; vertical-align: top;">
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Order Number</span>
                      <span style="font-size: 16px; color: #1e293b; font-weight: 600;">${data.duplicateOf.orderNumber}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Customer</span>
                      <span style="font-size: 14px; color: #1e293b;">${data.duplicateOf.customerName || 'Unknown'}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Email</span>
                      <span style="font-size: 14px; color: #1e293b;">${data.duplicateOf.customerEmail}</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                      <span style="font-size: 12px; color: #64748b; display: block;">Total</span>
                      <span style="font-size: 16px; color: #1e293b; font-weight: 600;">${data.duplicateOf.currency} ${data.duplicateOf.totalPrice}</span>
                    </div>
                    <div>
                      <span style="font-size: 12px; color: #64748b; display: block;">Created</span>
                      <span style="font-size: 13px; color: #64748b;">${matchDate}</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Action Buttons -->
          <tr>
            <td style="padding: 32px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" style="padding-right: 8px;">
                    <a href="${orderUrl}" target="_blank" style="display: block; background-color: #dc2626; color: #ffffff; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                      View Flagged Order
                    </a>
                  </td>
                  <td width="50%" style="padding-left: 8px;">
                    <a href="${matchOrderUrl}" target="_blank" style="display: block; background-color: #1e293b; color: #ffffff; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                      View Matched Order
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; text-align: center;">
                This alert was sent because a potential duplicate order was detected in your store.
              </p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">
                Manage your notification settings in the <a href="https://${shopDomain}/admin/apps/order-auditor" style="color: #0369a1; text-decoration: none;">Order Auditor app</a>.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Format Slack message
   */
  private formatSlackMessage(shopDomain: string, data: NotificationData): any {
    const orderUrl = `https://${shopDomain}/admin/orders/${data.order.shopifyOrderId}`;

    return {
      text: "🚨 Duplicate Order Detected",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🚨 Duplicate Order Detected",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Order Number:*\n${data.order.orderNumber}`,
            },
            {
              type: "mrkdwn",
              text: `*Customer:*\n${data.order.customerName || "Unknown"}`,
            },
            {
              type: "mrkdwn",
              text: `*Email:*\n${data.order.customerEmail}`,
            },
            {
              type: "mrkdwn",
              text: `*Total:*\n${data.order.currency} ${data.order.totalPrice}`,
            },
            {
              type: "mrkdwn",
              text: `*Confidence:*\n${data.confidence}%`,
            },
            {
              type: "mrkdwn",
              text: `*Match Reason:*\n${data.matchReason}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Matched Order:* ${data.duplicateOf.orderNumber}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View Order in Shopify",
                emoji: true,
              },
              url: orderUrl,
              style: "primary",
            },
          ],
        },
      ],
    };
  }
}

export const notificationService = new NotificationService();
