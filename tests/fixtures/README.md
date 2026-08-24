# Fixtures

Whole javdb movie pages, saved from a browser on 2026-08-22, used by
`tests/detail-page.test.ts` to check the parser against real markup rather than
markup written from the same assumptions the parser makes.

Each file is named for the video code it contains. `achj-090-en.html` is an
English-locale page: javdb serves the metadata panel in the account's language,
so its labels are ID/Rating/Tags rather than 番號/評分/類別. The parser must read
both. Between them they cover one
actor and several, a one-image gallery and a twenty-one-image one, and integer
and fractional ratings.

`search-hits.html` and `search-empty.html` are real search pages, saved the same
way. The empty one matters: javdb renders no results container at all when a
search matches nothing, only an `empty-message`, and mistaking that for markup
drift would make every genuinely missing code retry forever.

One shape is still NOT covered here and is tested from hand-written markup
instead: a movie page carrying both a translated and an original title. Save a
real example and switch that test over.

The `csrf-token` meta in the two search pages was replaced with `REDACTED`;
nothing else was altered.
