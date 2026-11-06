# 3D Home Tours

A free, static website that turns a listing's floor plan, photos and room sizes into a 3D walkthrough
your clients open from a link. No server, no database, no build step.

- **Dollhouse + Walk modes**: orbit the whole home, or walk room to room (WASD/arrow keys, or the on-screen pad on phones).
- **Furniture placement**: 30+ pieces (beds, sofas, tables, kitchen and bath fixtures). Drag to move; red means it overlaps something.
- **"Will it fit?"**: checks the room size, recommended walkway space, and whether it gets through the front door and the room's doorway.
- **Photos** pinned to rooms (camera button in 3D) plus a full gallery.
- **Branded footer**: you ("Presented by") and the listing agent ("Listed by"), with NMLS/license number, contact links, headshots, accent color and disclaimer.
- **Shareable layouts**: a client can arrange furniture and copy a link that reopens their exact layout.

## Pages

| Page | What it's for |
|---|---|
| `builder.html` | You make a tour here (it works in your browser and autosaves your draft). |
| `view.html?l=<name>` | The link you send. |
| `index.html` | Simple home page listing your tours (from `listings/index.json`). |

## Make a tour for a new listing (about 10 minutes)

1. Open **builder.html** and click **New listing**.
2. **Listing details**: address, price, beds/baths.
3. **Floor plan image**: upload the plan (JPG/PNG). Then **Calibrate**: drag along one wall whose length you know (for example a room labeled 14' × 12') and type the real length.
4. **Rooms & doors**: choose **Draw room** and drag a box over each room. Edges snap together so walls line up. Rename each room and fix sizes in the panel (accepts `12' 6"`, `12.5`, `150in`).
   Choose **Add door** and click on walls where the doors are. In the room panel, switch wide openings to **Open archway**.
   *No floor plan? Just use "Add room by size" and drag the rooms next to each other.*
5. **Photos**: add listing photos and pick a room for each one.
6. **Branding**: your info shows up already if you clicked **Save as my default** once. Add the listing agent.
7. **3D preview & staging**: check the 3D model and stage furniture. Whatever you place becomes the starting layout clients see.
8. **Preview as visitor ↗** shows the exact client page. When it looks right, click **Download listing.json**.
9. Upload the file to `listings/<link-name>/listing.json` on your site and send `https://<your-site>/view.html?l=<link-name>`.
   (Optionally add `{ "slug": "<link-name>", "title": "..." }` to `listings/index.json` so it appears on the home page.)

`listing.json` is self-contained (photos are packed inside), so each listing is a single file.
To edit a published tour later, open `builder.html?l=<link-name>`, or use **Open listing.json**.

## Your default branding

Edit `config/brand.json` with your name, title, company, NMLS #, phone, email, accent color and default disclaimer.
New listings start from it. Each listing can override it, and the listing agent is set per listing.
Have your compliance team review the disclaimer text for your states.

## Host it free

Any static host works. Pick one:

- **Netlify Drop** (easiest): go to app.netlify.com/drop and drag this whole folder in. To add a listing later, add its folder and drag the folder in again (or connect a GitHub repo for automatic deploys).
- **GitHub Pages**: create a repository, upload these files, then Settings → Pages → "Deploy from a branch" (`main`, `/root`). New listings: Add file → Upload files into `listings/<link-name>/`.
- **Cloudflare Pages**: create a project, choose "Direct upload" and upload this folder.

The `_headers` file tells Netlify and Cloudflare not to cache code and listings, so updates show up immediately.
GitHub Pages ignores that file and caches for about 10 minutes.

## Run it on your computer

Pages load data with `fetch`, so open them through a local web server, not by double-clicking:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000/builder.html.

## How it works (for the curious)

- `js/model.js`: units, wall generation (merges shared room edges and cuts door openings), furniture catalog, fit checks, auto-placement. Pure JS with no browser dependencies.
- `js/viewer3d.js`: Three.js scene, dollhouse/walk controls, collision, furniture dragging.
- `js/furniture3d.js`, `js/textures.js`: procedural furniture models and floor textures (nothing to download).
- `js/plan-editor.js`: the 2D tracing canvas. `js/builder-page.js` / `js/view-page.js`: the two pages. `js/panels.js`: the shared fit checker and furniture panel.
- Three.js 0.160 loads from the jsDelivr CDN.

Limits worth knowing: rooms are rectangles (draw an L-shaped room as two touching rectangles joined by a full-width open archway), walls aren't detected automatically
from the image (you trace them, which keeps them accurate), and all dimensions are only as accurate as the floor plan.
