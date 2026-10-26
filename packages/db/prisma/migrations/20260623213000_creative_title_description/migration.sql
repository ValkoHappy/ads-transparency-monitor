ALTER TABLE "Creative"
ADD COLUMN "title" TEXT,
ADD COLUMN "description" TEXT;

UPDATE "Creative" c
SET "title" = CASE
      WHEN c."title" IS NULL OR btrim(c."title") = '' THEN a."name"
      ELSE c."title"
    END,
    "description" = CASE
      WHEN c."description" IS NULL OR btrim(c."description") = '' THEN a."description"
      ELSE c."description"
    END
FROM "App" a
WHERE a."id" = c."appDbId"
  AND (
    ((c."title" IS NULL OR btrim(c."title") = '') AND a."name" IS NOT NULL)
    OR ((c."description" IS NULL OR btrim(c."description") = '') AND a."description" IS NOT NULL)
  );
