export default function manifest() {
  return {
    name: "GPT — AI Chat & Images",
    short_name: "GPT",
    description:
      "A private AI assistant for writing, answering questions, coding and creating images.",
    start_url: "/",
    display: "standalone",
    background_color: "#212121",
    theme_color: "#212121",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}