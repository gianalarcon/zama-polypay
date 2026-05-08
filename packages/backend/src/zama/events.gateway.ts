import { Logger } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { JOIN_ACCOUNT_ROOM } from "@polypay/shared";
import { Server, Socket } from "socket.io";

/**
 * Polypay-Zama events gateway.
 *
 * One global gateway: clients connect with `?commitment=...&accountAddress=...`
 * in the handshake query. We auto-join the per-account room on connect and
 * also expose a JOIN_ACCOUNT_ROOM message so the client can switch rooms
 * without reconnecting.
 *
 * Services emit account-scoped events via `emitToAccount(address, event, data)`
 * — only sockets that joined the matching room receive them.
 */
@WebSocketGateway({
  cors: { origin: "*" },
  transports: ["websocket"],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    const commitment = client.handshake.query.commitment as string | undefined;
    const accountAddress = client.handshake.query.accountAddress as string | undefined;

    if (!commitment) {
      client.disconnect();
      return;
    }

    client.data.commitment = commitment;
    if (accountAddress) {
      const room = this.accountRoom(accountAddress);
      void client.join(room);
      client.data.accountAddress = accountAddress;
    }
    this.logger.log(`connect ${client.id} commitment=${commitment.slice(0, 10)} account=${accountAddress ?? "-"}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`disconnect ${client.id}`);
  }

  @SubscribeMessage(JOIN_ACCOUNT_ROOM)
  onJoinAccount(client: Socket, accountAddress: string): { ok: true } {
    const previous = client.data.accountAddress as string | undefined;
    if (previous) void client.leave(this.accountRoom(previous));
    void client.join(this.accountRoom(accountAddress));
    client.data.accountAddress = accountAddress;
    return { ok: true };
  }

  /** Emit an event to every socket currently in the account's room. */
  emitToAccount(accountAddress: string, event: string, data: unknown): void {
    this.server.to(this.accountRoom(accountAddress)).emit(event, data);
  }

  /** Broadcast an event to every connected client (no room filter). */
  broadcast(event: string, data: unknown): void {
    this.server.emit(event, data);
  }

  private accountRoom(accountAddress: string): string {
    return `account:${accountAddress.toLowerCase()}`;
  }
}
