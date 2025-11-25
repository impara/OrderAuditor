import { Session, SessionStorage } from "@shopify/shopify-api";
import { db } from "./db";
import { shopifySessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./utils/logger";

export class PostgresSessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    logger.info(`[SessionStorage] *** storeSession CALLED *** for shop: ${session.shop}, isOnline: ${session.isOnline}, id: ${session.id}`);
    try {
      logger.info(`[SessionStorage] Attempting database insert...`);
      
      await db
        .insert(shopifySessions)
        .values({
          id: session.id,
          shop: session.shop,
          state: session.state || "", // Provide empty string if state is undefined
          isOnline: session.isOnline,
          scope: session.scope,
          expires: session.expires ? new Date(session.expires) : undefined,
          accessToken: session.accessToken,
          userId: session.onlineAccessInfo?.associated_user.id.toString(),
          firstName: session.onlineAccessInfo?.associated_user.first_name,
          lastName: session.onlineAccessInfo?.associated_user.last_name,
          email: session.onlineAccessInfo?.associated_user.email,
          accountOwner: session.onlineAccessInfo?.associated_user.account_owner,
          locale: session.onlineAccessInfo?.associated_user.locale,
          collaborator: session.onlineAccessInfo?.associated_user.collaborator,
          emailVerified: session.onlineAccessInfo?.associated_user.email_verified,
        })
        .onConflictDoUpdate({
          target: shopifySessions.id,
          set: {
            shop: session.shop,
            state: session.state || "", // Provide empty string if state is undefined
            isOnline: session.isOnline,
            scope: session.scope,
            expires: session.expires ? new Date(session.expires) : undefined,
            accessToken: session.accessToken,
            userId: session.onlineAccessInfo?.associated_user.id.toString(),
            firstName: session.onlineAccessInfo?.associated_user.first_name,
            lastName: session.onlineAccessInfo?.associated_user.last_name,
            email: session.onlineAccessInfo?.associated_user.email,
            accountOwner: session.onlineAccessInfo?.associated_user.account_owner,
            locale: session.onlineAccessInfo?.associated_user.locale,
            collaborator: session.onlineAccessInfo?.associated_user.collaborator,
            emailVerified: session.onlineAccessInfo?.associated_user.email_verified,
          },
        });
      
      logger.info(`[SessionStorage] Successfully stored session for shop: ${session.shop}`);
      return true;
    } catch (error: any) {
      logger.error(`[SessionStorage] FAILED to store session for shop: ${session.shop}`, error);
      logger.error(`[SessionStorage] Error details: ${error.message}`);
      logger.error(`[SessionStorage] Error stack: ${error.stack}`);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      logger.debug(`[SessionStorage] Loading session: ${id}`);
      
      const [row] = await db
        .select()
        .from(shopifySessions)
        .where(eq(shopifySessions.id, id))
        .limit(1);

      if (!row) {
        logger.debug(`[SessionStorage] Session not found: ${id}`);
        return undefined;
      }

      const session = new Session({
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.isOnline,
        scope: row.scope || undefined,
        expires: row.expires ? new Date(row.expires) : undefined,
        accessToken: row.accessToken || undefined,
      });

      if (row.userId) {
        session.onlineAccessInfo = {
          associated_user: {
            id: Number(row.userId),
            first_name: row.firstName || "",
            last_name: row.lastName || "",
            email: row.email || "",
            account_owner: row.accountOwner || false,
            locale: row.locale || "",
            collaborator: row.collaborator || false,
            email_verified: row.emailVerified || false,
          },
          associated_user_scope: row.scope || "",
          expires_in: 0,
        };
      }

      logger.debug(`[SessionStorage] Successfully loaded session for shop: ${row.shop}`);
      return session;
    } catch (error: any) {
      logger.error(`[SessionStorage] Error loading session ${id}:`, error);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      logger.debug(`[SessionStorage] Deleting session: ${id}`);
      await db.delete(shopifySessions).where(eq(shopifySessions.id, id));
      return true;
    } catch (error: any) {
      logger.error(`[SessionStorage] Error deleting session ${id}:`, error);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      logger.debug(`[SessionStorage] Deleting ${ids.length} sessions`);
      for (const id of ids) {
        await this.deleteSession(id);
      }
      return true;
    } catch (error: any) {
      logger.error(`[SessionStorage] Error deleting sessions:`, error);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      logger.debug(`[SessionStorage] Finding sessions for shop: ${shop}`);
      
      const rows = await db
        .select()
        .from(shopifySessions)
        .where(eq(shopifySessions.shop, shop));

      logger.debug(`[SessionStorage] Found ${rows.length} sessions for shop: ${shop}`);

      return rows.map((row) => {
        const session = new Session({
          id: row.id,
          shop: row.shop,
          state: row.state,
          isOnline: row.isOnline,
          scope: row.scope || undefined,
          expires: row.expires ? new Date(row.expires) : undefined,
          accessToken: row.accessToken || undefined,
        });
        
        // Rehydrate onlineAccessInfo if user data exists
        if (row.userId) {
          session.onlineAccessInfo = {
            associated_user: {
              id: Number(row.userId),
              first_name: row.firstName || "",
              last_name: row.lastName || "",
              email: row.email || "",
              account_owner: row.accountOwner || false,
              locale: row.locale || "",
              collaborator: row.collaborator || false,
              email_verified: row.emailVerified || false,
            },
            associated_user_scope: row.scope || "",
            expires_in: 0,
          };
        }
        
        return session;
      });
    } catch (error: any) {
      logger.error(`[SessionStorage] Error finding sessions by shop ${shop}:`, error);
      return [];
    }
  }
}
