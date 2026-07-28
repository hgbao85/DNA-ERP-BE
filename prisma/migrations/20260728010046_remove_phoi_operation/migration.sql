/*
  Warnings:

  - You are about to drop the column `phoiOperation` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "phoiOperation";

-- DropEnum
DROP TYPE "PhoiOperation";
