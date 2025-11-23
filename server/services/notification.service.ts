import { logger } from "../utils/logger";
import type { DetectionSettings, Order } from "@shared/schema";

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
    settings: DetectionSettings,
    data: NotificationData
  ): Promise<void> {
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
      promises.push(this.sendEmailNotification(settings.notificationEmail, data));
    }

    // Send Slack notification if configured
    if (settings.slackWebhookUrl) {
      promises.push(this.sendSlackNotification(settings.slackWebhookUrl, data));
    }

    // Wait for all notifications to complete (don't fail if one fails)
    await Promise.allSettled(promises);
  }

  /**
   * Send email notification via SMTP
   */
  private async sendEmailNotification(
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

      // For now, use a simple fetch-based approach or nodemailer
      // Since we don't have nodemailer yet, we'll use a simple implementation
      // that can be enhanced later with a proper email service
      
      const emailBody = this.formatEmailBody(data);
      const subject = `Duplicate Order Detected: ${data.order.orderNumber}`;

      // If nodemailer is available, use it; otherwise log that email service needs configuration
      logger.info(`[Notification] Would send email to ${email}`, {
        subject,
        body: emailBody.substring(0, 100) + "...",
      });

      // TODO: Implement actual email sending with nodemailer or email service
      // For MVP, we'll log the notification
      logger.warn(
        "[Notification] Email sending not fully implemented. Install nodemailer or configure email service."
      );
    } catch (error) {
      logger.error("[Notification] Failed to send email notification:", error);
      // Don't throw - allow other notifications to proceed
    }
  }

  /**
   * Send Slack notification via webhook
   */
  private async sendSlackNotification(
    webhookUrl: string,
    data: NotificationData
  ): Promise<void> {
    try {
      const slackMessage = this.formatSlackMessage(data);

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
  private formatEmailBody(data: NotificationData): string {
    return `
Duplicate Order Detected

Order Details:
- Order Number: ${data.order.orderNumber}
- Customer: ${data.order.customerName || "Unknown"} (${data.order.customerEmail})
- Total: ${data.order.currency} ${data.order.totalPrice}
- Created: ${new Date(data.order.createdAt).toLocaleString()}

Duplicate Match:
- Matched Order: ${data.duplicateOf.orderNumber}
- Confidence: ${data.confidence}%
- Reason: ${data.matchReason}

Please review these orders in your Shopify admin.
    `.trim();
  }

  /**
   * Format Slack message
   */
  private formatSlackMessage(data: NotificationData): any {
    const orderUrl = process.env.SHOPIFY_SHOP_DOMAIN
      ? `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/orders/${data.order.shopifyOrderId}`
      : "#";

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


