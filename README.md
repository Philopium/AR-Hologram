# AR Demo (MindAR + Three.js) — Seamless GLTF Loop (No UI) + Light Approximation & Smoothing

Questa variante aggiunge:
- sampling della camera per stimare **luminosità media** e **colore dominante** (approssimazione), che viene applicata alle luci di scena;
- smoothing della trasformazione del modello (position + rotation) rispetto all'anchor per ridurre jitter.

## Cosa fare prima di usare
1. Genera `targets.mind` con la tua immagine target (vedi precedente README).
2. Metti il tuo modello `.glb` in `models/model.glb`.
3. Carica la repo su GitHub Pages (HTTPS obbligatorio).

## Limitazioni
- Questo non è un vero sistema di *light estimation* come WebXR; è un'approssimazione basata su colore e luminanza medi della camera.
- Non stima direzione della luce, ombre o HDR reali, ma migliora significativamente la coerenza visiva in molti casi pratici.

## File principali
- `index.html`
- `app/main.js` (contiene logica per sampling, smoothing e caricamento modello)
- `models/` (metti qui `model.glb`)
- `targets/` (metti qui `targets.mind`)

