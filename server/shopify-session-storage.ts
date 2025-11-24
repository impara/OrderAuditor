import { Session } from "@shopify/shopify-api";
import { db } from "./db";
import { shopifySessions } from "@shared/schema";
import { eq } from "drizzle-orm";

export class PostgresSessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    try {
      await db
        .insert(shopifySessions)
        .values({
          id: session.id,
          shop: session.shop,
          state: session.state,
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
            state: session.state,
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
      return true;
    } catch (error) {
      console.error("Error storing session:", error);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const [row] = await db
        .select()
        .from(shopifySessions)
        .where(eq(shopifySessions.id, id))
        .limit(1);

      if (!row) return undefined;

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

      return session;
    } catch (error) {
      console.error("Error loading session:", error);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await db.delete(shopifySessions).where(eq(shopifySessions.id, id));
      return true;
    } catch (error) {
      console.error("Error deleting session:", error);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      for (const id of ids) {
        await this.deleteSession(id);
      }
      return true;
    } catch (error) {
      console.error("Error deleting sessions:", error);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const rows = await db
        .select()
        .from(shopifySessions)
        .where(eq(shopifySessions.shop, shop));

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
    } catch (error) {
      console.error("Error finding sessions by shop:", error);
      return [];
    }
  }
}
