declare module "*.css";

declare module "*.html?raw" {
  const html: string;
  export default html;
}
