import type { TypeRef } from "./type-ref.js";

export interface ActivityTypeRef extends TypeRef {
  parentTypeId: number;
}
