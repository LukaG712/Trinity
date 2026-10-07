# Troved

Troved is a small, responsive wishlist app. This source package contains no personal Markdown files or wishlist entries; its seed is empty so it can live in a public code repository.

## Run locally

```powershell
npm install
npm run dev
```

## Save to a folder

Open **Settings → Wishlist folder** and choose a folder. In browsers that support the File System Access API, Troved stores the wishlist in `wishlist.json` there and autosaves after each change. The browser keeps a fallback copy as well. Direct folder access requires a supported browser and HTTPS or localhost. If the browser asks for folder access again later, use **Reconnect folder**.

In browsers that do not support writing to a chosen folder, use **Restore from JSON** to load your `wishlist.json`, then **Download JSON** after editing and save the downloaded file back into your folder. You can set that folder as your browser's download location. Browser security does not let a website silently write to an arbitrary folder without an explicit browser API.

When you choose a folder that already contains `wishlist.json`, Troved merges it with the current browser copy before saving. The folder's version wins when the same item exists in both; unique groups and items from both copies are kept. Disconnecting a folder leaves its file untouched.

Troved no longer reads or writes wishlist data through GitHub. It clears the old GitHub sync token from the current browser session but does not delete or modify any existing GitHub repository. Keep personal Markdown and CSV files outside the public app source. Files you select for import are read in the browser; only entries you confirm are written to the selected folder.

## Download a backup

In **Settings → Wishlist folder**, choose **Download ZIP backup** to save a snapshot that works in any browser. The ZIP contains `wishlist.json` and a short README. Download another backup whenever you want a newer snapshot; folder autosave remains available in supported browsers.

To restore in a browser without folder access, extract the ZIP on your computer, then choose **Restore from JSON** in **Settings → Wishlist folder** and select the extracted `wishlist.json`. Troved merges those groups and items into the current browser wishlist and keeps them there. Existing entries are preserved; duplicate groups/items are not added twice.

## Importing

Choose **Import files** and select `.md`, `.markdown`, or `.csv` files. Markdown headings and lists are used to infer group names, subgroups, item names, links, and explicitly labeled EUR prices. Common wishlist CSV columns are also supported. Troved reads files in the browser and does not upload them to a Troved backend. Optional Ollama assistance sends Markdown text only to the Ollama server you configure. Items without an explicit EUR price remain unpriced; amounts with an unverified or non-EUR currency are flagged and excluded from totals.

### Optional Ollama item detection

Open **Settings → Ollama item detection**, enter your Ollama server URL (default `http://localhost:11434`), then choose **Connect Ollama**. Troved lists the models already installed on that server; it does not download models. During Markdown import review, choose **Improve with Ollama** to ask the selected model to distinguish purchase items from notes and sort them into groups/subgroups. The deterministic browser parser remains available, CSV import stays structured, and every result can be reviewed before saving. Price and link values are kept only when the local parser identified them in the source.

When you click the AI assist button, Markdown text is sent to the configured Ollama server. With the default URL, Ollama processes it on your own computer. If connecting from a hosted Troved page or another non-loopback origin, Ollama may need that page origin added to `OLLAMA_ORIGINS` before restarting Ollama; see the [Ollama CORS guidance](https://github.com/ollama/ollama/blob/main/docs/faq.mdx#how-can-i-allow-additional-web-origins-to-access-ollama).

## Currency

Item prices are stored in EUR. Other display currencies use the latest daily reference rate from Frankfurter; converted values remain estimates.
