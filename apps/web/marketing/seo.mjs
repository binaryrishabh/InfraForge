export const origin = "https://infraforge.lapwork.in";
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g,
  (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]);

export function addSeo(html, page) {
  const home = page === "index";
  const url = `${origin}/${home ? "" : page}`;
  const title = home ? "InfraForge: see exactly why your system breaks" : text(html.match(/<title>(.*?)<\/title>/s)[1]);
  const description = home
    ? "Design cloud infrastructure, run it under recorded load and watch where and why it breaks. Learn distributed systems, or test your own stack before you ship."
    : text(html.match(/<meta name="description" content="([^"]*)">/)[1]);
  html = html.replace(/<title>.*?<\/title>/s, `<title>${escape(title)}</title>`);
  if (home) html = html.replace("</title>", `</title><meta name="description" content="${escape(description)}">`);
  const graph = home ? [
    { "@type": "WebSite", name: "InfraForge", url },
    { "@type": "Organization", name: "InfraForge", url },
  ] : [
    {
      "@type": "FAQPage",
      mainEntity: [...html.matchAll(page === "engineering"
        ? /<details[^>]*><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs
        : /<div><h3>(.*?)<\/h3><p>(.*?)<\/p><\/div>/gs)]
        // Learning's other cards also use h3/p pairs; only .qa contributes FAQ text.
        .filter((match) => page === "engineering" || (
          match.index > html.indexOf('<div class="qa">') && match.index < html.indexOf('<section class="l-close"')))
        .map(([, question, answer]) => ({ "@type": "Question", name: text(question), acceptedAnswer: { "@type": "Answer", text: text(answer) } })),
    },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: page === "engineering" ? "Engineering" : "Learning", item: url },
    ] },
  ];
  if (!home && !graph[0].mainEntity.length) throw new Error(`Missing ${page} FAQ`);
  const tags = `<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="InfraForge">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>`;
  return html.replace("</head>", `${tags}</head>`);
}
