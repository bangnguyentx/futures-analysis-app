// client/src/socket.js
import { io } from "socket.io-client";

const socket = io("/", {
  transports: ["websocket"], // ưu tiên websocket
});

export default socket;
