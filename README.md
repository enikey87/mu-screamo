# Битва с Быничем

Перетягивание шкалы с Быничем. Он тянет, пока мычит. Шкала едет от «мууу», не от крика.

Концепт: [CONCEPT.md](CONCEPT.md).

```bash
npm install
npm test
npm run dev
```

Сборка публикуется на GitHub Pages с `main`: https://enikey87.github.io/mu-screamo/

Правила раунда живут в `src/core` и не знают про страницу. Длины окон и дыхание дня меняются там, `npm test` проверяет их без микрофона.
