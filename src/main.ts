import { createApp } from "./app";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root was not found.");
}

createApp(root);

if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
  });
}
