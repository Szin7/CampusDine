# Menu recommendations

Three previous orders are the cutoff for **Your usuals**. This is a product choice, kept in `USUALS_MIN_ORDERS`, not a statistical threshold. SQL ranks items by the number of orders containing them, then their latest purchase timestamp. Ordering twenty teas once still counts as one purchase occasion.

For students with one or two orders, the nightly job builds a binary order–item pivot table with pandas. With matrix X, co-occurrence is C = XᵀX. Similarity between items i and j is Cij / sqrt(Cii × Cjj), with zero for an unobserved item. The job subtracts the target student's own basket contributions from C **before** computing the denominator. Their purchases supply the seed items, but do not supply evidence for their own suggestions.

A candidate's score is its mean similarity to the student's distinct seed items. Previously tried items are excluded from collaborative scores. Scores are affinities, not probabilities or dietary advice. The batch only saves results for active, approved students with thin histories. All completed checkouts count as purchase history, including orders still being prepared.

`GET /menu/recommendations?limit=6` requires a student session and returns:

```json
{"items": [{"item": {"id": 2, "name": "Milk tea", "price": 3000, "category": "Drinks", "is_available": true, "is_archived": false}, "source": "collaborative"}]}
```

Each entry carries `usual`, `collaborative`, `popular`, or `menu` so the frontend can label it honestly. The endpoint fills remaining spaces with this week's popular items, then available menu items. Popularity counts orders, not quantity, from Monday through today in Kathmandu. These fallback entries can include previously tried items. Empty canteen history is labelled `menu`, never “popular.”

Unavailable and archived items are filtered on every request. A batch older than 48 hours, or one built before the student's latest order, is ignored. This keeps the endpoint useful if the scheduled job misses a night. The current implementation reads all baskets into memory; the matrix should remain manageable for one canteen, but memory use should be measured before retaining many years of orders.

## Run and schedule

From `backend`, with the project's virtual environment active:

```sh
python -m pip install -e '.[dev]'
python -m alembic upgrade head
python -m app.jobs.rebuild_recommendations
python -m pytest -q
```

Run the batch once after migration, then nightly. `deploy/recommendations.cron` contains a user-crontab entry for a server whose cron daemon uses UTC: 20:15 UTC is 02:00 the following morning in Nepal. Adjust the installation path and virtual environment path before installing it with `crontab -e`. If the server's cron timezone is Kathmandu, use `0 2 * * *` instead. Do not install both entries. Check the job log for failures; a missed run is retried on the next scheduled night, while requests use the fallback.

The job uses `CAMPUSDINE_DB_PATH` from the backend `.env`, just like the API. Run it under the same system account so it can open the database and its WAL files. It runs independently of Uvicorn; no API startup hook or extra web worker is involved.

The read snapshot closes before matrix calculation, so checkout does not wait for pandas. Publishing deletes and inserts scores in one short write transaction. A failed insert rolls the whole replacement back. A late-finishing older batch cannot overwrite a newer snapshot. No web server restart is needed after a rebuild.
