// Single source of truth for the deploy build number + default model.
// Shown at the bottom of the screen so you can confirm, at a glance, which
// build/model is actually live after a deploy.
//
// 👉 Bump APP_BUILD by one on every deploy.
export const APP_BUILD = 3;

// Default OpenAI model when OPENAI_MODEL env is not set. The API routes and the
// on-screen badge both read this, so they never drift apart.
export const DEFAULT_MODEL = "gpt-5.4-mini";
