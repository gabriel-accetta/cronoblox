# Improvement changelog

| Experiment | Reason | Evidence / outcome | Decision |
| --- | --- | --- | --- |
| Numeric breakout probability | Tempting compact output | No validated historical labeled model exists; precision would be misleading | Removed |
| Current-data normalized rates | Compare engagement without treating scale as quality | Favorites and votes per 1,000 visits remain auditable | Kept |
| Critic after initial thesis | Surface alternative explanations | Explicitly checks snapshot duration, source concentration, unsupported claims, and missing coverage | Kept |
| Automatic historical ML | Could improve forecasting | No legally usable labeled history is available | Deferred |
| Redis as state store | Simple queue access | Would make runs non-durable and hard to reproduce | Removed; PostgreSQL is authoritative |
