import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yalle · תבנה לי טיול",
    short_name: "Yalle",
    description: "תבנה לי טיול — האפליקציה שבונה את הטיול המשפחתי שלכם, בעברית.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ec",
    theme_color: "#0e6b5e",
    lang: "he",
    dir: "rtl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
