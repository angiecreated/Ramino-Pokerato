# 🃏 Ramino Pokerato

La variante pazza del Ramino Pokerato con le 8 aperture.

## Setup

### 1. Installa le dipendenze
```bash
npm install
```

### 2. Avvia in locale
```bash
npm start
```

### 3. Build per produzione
```bash
npm run build
```

### 4. Deploy su Firebase
```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

## Deploy automatico con GitHub Actions

1. Vai su Firebase Console → Impostazioni progetto → Account di servizio
2. Genera nuova chiave privata (scarica il JSON)
3. Vai su GitHub → Repository → Settings → Secrets → Actions
4. Crea secret: `FIREBASE_SERVICE_ACCOUNT` con il contenuto del JSON

Ogni push su `main` farà deploy automatico! 🚀

## Regole del gioco

- 13 carte a testa
- Si pesca solo dal mazzo
- Ogni giocatore ha 8 aperture disponibili, ognuna usabile una volta sola
- Le 8 aperture: Coppia, Doppia Coppia, Tris, Full, Poker, Scala Colore (5 carte), Scala 40, Chiusura in Mano
- I jolly non si usano nelle aperture ma dal turno successivo sì
- Un jolly a terra può essere sostituito con la carta vera
- Non si può scartare il jolly
- Vince chi fa tutte le 8 aperture con meno punti
