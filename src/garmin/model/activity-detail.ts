import type { ActivitySummaryDTO } from "./activity-summary-dto.ts";
import type { ActivityTypeRef } from "./activity-type-ref.ts";
import type { TypeRef } from "./type-ref.ts";

/** From the activity endpoint (get_activity) — full detail for one activity. */
export interface ActivityDetail {
  activityId: number;
  activityUUID: { uuid: string };
  activityName: string;
  userProfileId: number;
  isMultiSportParent: boolean;
  activityTypeDTO: ActivityTypeRef;
  eventTypeDTO: TypeRef;
  accessControlRuleDTO: TypeRef;
  timeZoneUnitDTO: { timeZone: string };
  metadataDTO: {
    isOriginal: boolean;
    fileFormat: { formatId: number; formatKey: string };
    lastUpdateDate: string;
    uploadedDate: string;
    manufacturer: string;
    lapCount: number;
    personalRecord: boolean;
    favorite: boolean;
    manualActivity: boolean;
  };
  summaryDTO: ActivitySummaryDTO;
  locationName: string;
}
