export interface ReservoirCollectionAttributes {
  attributes: ReservoirCollectionAttribute[];
}

export interface ReservoirCollectionAttribute {
  key: string;
  attributeCount: number;
  kind: string;
  values: { count: number; value: string; floorAsPrice: number }[];
}
