import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NanaBanana · מתכננים טיול",
    short_name: "NanaBanana",
    description: "מתכננים את הטיול המשפחתי המושלם — בעברית.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#1d9e75",
    lang: "he",
    dir: "rtl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
