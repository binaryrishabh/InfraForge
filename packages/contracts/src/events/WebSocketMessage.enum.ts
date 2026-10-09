export enum WebSocketMessage {
  Subscribe = "subscribe",
  Unsubscribe = "unsubscribe"
}

export type WebSocketMessageType = (typeof WebSocketMessage)[keyof typeof WebSocketMessage];