import "jsdom";

declare module "jsdom" {
  interface ConstructorOptions {
    userAgent?: string;
  }
}