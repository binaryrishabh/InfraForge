import { expect, test } from "bun:test";
import { activityLabel, availableLessons, discoverLessons, EMPTY_FILTERS, lessonMode, prerequisiteLessons } from "../src/features/learning/discovery";
import { readDeviceLesson, saveDeviceLesson, type DeviceStorage } from "../src/features/learning/deviceLocal";
import { attempted, catalog, concept, lab, reading } from "./learningFixtures";

test("discovery keeps published track/module order and combines filters", () => {
  expect(availableLessons(catalog).map((l) => l.id)).toEqual([reading.id, concept.id, lab.id]);
  for (const filters of [{ kind: "reading" as const }, { level: "beginner" as const, resource: "DNS" }, { track: "foundations", search: "  REQUESTS  routing dns " }]) {
    expect(discoverLessons(catalog, { ...EMPTY_FILTERS, ...filters }).length).toBe(1);
  }
  expect(discoverLessons(catalog, { ...EMPTY_FILTERS, resource: "Database", kind: "executable-lab", level: "intermediate" }).map((l) => l.id)).toEqual([lab.id]);
  for (const filters of [{ resource: "Firewall" }, { track: "unknown" }, { search: "nonexistent" }, { resource: "Database", kind: "reading" as const }]) {
    expect(discoverLessons(catalog, { ...EMPTY_FILTERS, ...filters })).toEqual([]);
  }
});

test("draft lessons and parents and mismatched membership never become available", () => {
  expect(availableLessons({ ...catalog, lessons: catalog.lessons.map((l) => ({ ...l, availability: "draft" })) })).toEqual([]);
  expect(availableLessons({ ...catalog, tracks: catalog.tracks.map((t) => ({ ...t, availability: "draft" })) })).toEqual([]);
  expect(availableLessons({ ...catalog, tracks: catalog.tracks.map((t) => ({ ...t, modules: t.modules.map((m) => ({ ...m, availability: "draft" })) })) })).toEqual([]);
  expect(availableLessons({ ...catalog, lessons: catalog.lessons.map((l) => ({ ...l, moduleId: "different" })) })).toEqual([]);
});

test("prerequisites remain advisory and unresolved references are explicit", () => {
  expect(prerequisiteLessons(lab, catalog)).toEqual([{ id: concept.id, lesson: concept }]);
  expect(prerequisiteLessons({ ...lab, prerequisites: ["missing"] }, catalog)).toEqual([{ id: "missing", lesson: null }]);
  expect(discoverLessons(catalog, EMPTY_FILTERS)).toContainEqual(lab);
});

test("conceptual labels and lab activity depend only on matching server facts", () => {
  expect(lessonMode(reading)).toBe("Conceptual only");
  expect(lessonMode(lab)).toBe("Linked challenge lab");
  expect(activityLabel(reading, { ...attempted, lessonId: reading.id })).toBeNull();
  expect(activityLabel(lab, null)).toBeNull();
  expect(activityLabel(lab, { ...attempted, challengeId: "wrong" })).toBeNull();
  expect(activityLabel(lab, attempted)).toBe("Recorded attempt");
  expect(activityLabel(lab, { ...attempted, fromEarlierVersion: true })).toContain("earlier version activity");
});

test("device marks and answers round trip, are versioned, and tolerate corrupt or denied storage", () => {
  const values = new Map<string, string>();
  const storage: DeviceStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } };
  const value = { read: true, answer: "address" };
  expect(saveDeviceLesson(concept.id, 1, value, () => storage)).toBe(true);
  expect(readDeviceLesson(concept.id, 1, () => storage)).toEqual({ value, available: true });
  expect(readDeviceLesson(concept.id, 2, () => storage).value).toEqual({ read: false, answer: null });
  const denied = () => { throw Error("Storage denied"); };
  expect(saveDeviceLesson(concept.id, 1, value, denied)).toBe(false);
  expect(readDeviceLesson(concept.id, 1, denied)).toEqual({ value: { read: false, answer: null }, available: false });
  const throws: DeviceStorage = { getItem: denied, setItem: denied };
  expect(saveDeviceLesson(concept.id, 1, value, () => throws)).toBe(false);
  expect(readDeviceLesson(concept.id, 1, () => throws).available).toBe(false);
  expect(readDeviceLesson(concept.id, 1, () => ({ ...storage, getItem: () => "broken json" })).available).toBe(false);
  expect(readDeviceLesson(concept.id, 1, () => ({ ...storage, getItem: () => '{"read":1,"answer":{}}' })).value).toEqual({ read: false, answer: null });
});
