/**
 * Dynamic model dispatch (`client[modelKey]`) is inherently untyped - Prisma has no
 * generic "lookup a delegate by model name string" API. Disabled file-wide rather
 * than per call-site since every unsafe-* warning here traces back to that one gap.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Prisma } from '@prisma/client';
import { SOFT_DELETE_MODELS } from '../soft-delete-models.constant';

/** Minimal shape needed to dynamically call `client[modelKey].update(...)` by model name. */
interface DynamicDelegateClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [modelKey: string]: any;
}

function toModelKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Prisma Client Extension standing in for the deprecated `$use` middleware API:
 * - read operations on soft-deletable models transparently exclude `deletedAt` rows
 * - delete/deleteMany on those models are rewritten into update/updateMany setting `deletedAt`
 *
 * Known limitation: `update`/`updateMany` are not filtered against `deletedAt`, so a caller
 * holding a soft-deleted record's id could still mutate it. Acceptable for this scaffold;
 * revisit if a business module needs stricter guarantees.
 */
export function withSoftDelete() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'soft-delete',
      query: {
        $allModels: {
          async findMany({ model, args, query }) {
            if (SOFT_DELETE_MODELS.has(model)) {
              args.where = { ...args.where, deletedAt: null };
            }
            return query(args);
          },
          async findFirst({ model, args, query }) {
            if (SOFT_DELETE_MODELS.has(model)) {
              args.where = { ...args.where, deletedAt: null };
            }
            return query(args);
          },
          async findUnique({ model, args, query }) {
            if (!SOFT_DELETE_MODELS.has(model)) {
              return query(args);
            }
            // findUnique's `where` only accepts unique fields, so it can't be merged with
            // deletedAt directly - fall back to findFirst semantics instead. Spread `args`
            // first so `include`/`select`/etc. survive the conversion.
            const modelKey = toModelKey(model);
            return (client as DynamicDelegateClient)[modelKey].findFirst({
              ...args,
              where: { ...args.where, deletedAt: null },
            });
          },
          async count({ model, args, query }) {
            if (SOFT_DELETE_MODELS.has(model)) {
              args.where = { ...args.where, deletedAt: null };
            }
            return query(args);
          },
          async delete({ model, args, query }) {
            if (!SOFT_DELETE_MODELS.has(model)) {
              return query(args);
            }
            const modelKey = toModelKey(model);
            return (client as DynamicDelegateClient)[modelKey].update({
              ...args,
              where: args.where,
              data: { deletedAt: new Date() },
            });
          },
          async deleteMany({ model, args, query }) {
            if (!SOFT_DELETE_MODELS.has(model)) {
              return query(args);
            }
            const modelKey = toModelKey(model);
            return (client as DynamicDelegateClient)[modelKey].updateMany({
              ...args,
              where: args.where,
              data: { deletedAt: new Date() },
            });
          },
        },
      },
    }),
  );
}
