import type { TypeRef } from "./type-ref.ts";

export interface ActivityTypeRef extends TypeRef {
  parentTypeId: number;
}
