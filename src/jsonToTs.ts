// ============================================================
// jsonToTs.ts — JSON → TypeScript conversion engine
// v3.0 — Advanced inference
// ============================================================

export interface ConvertOptions {
  useInterface: boolean;
  rootName: string;
  addExport: boolean;
  useSemicolons: boolean;
  optionalNull: boolean;
  indent: number;
  /** Detect string literals as unions (enums) */
  detectEnums: boolean;
  /** Maximum number of unique values ​​to consider enum */
  enumMaxValues: number;
  /** Smart nullable: distinguishes optional (?) from nullable (| null) */
  smartNullable: boolean;
  /** Detect date patterns (ISO strings → Date | string) */
  detectDates: boolean;
  /** Generate real enums instead of string literal unions */
  useRealEnums: boolean;
}

const DEFAULT_OPTIONS: ConvertOptions = {
  useInterface: true,
  rootName: "Root",
  addExport: true,
  useSemicolons: true,
  optionalNull: true,
  indent: 2,
  detectEnums: true,
  enumMaxValues: 10,
  smartNullable: true,
  detectDates: true,
  useRealEnums: false,
};

// ── Internal structures ──

interface InterfaceEntry {
  name: string;
  properties: PropertyEntry[];
  isRootArray: boolean;
  rootArrayType: string;
  isInline: boolean;
}

interface EnumEntry {
  name: string;
  values: string[];
}

interface PropertyEntry {
  key: string;
  type: string;
  optional: boolean;
}

/** Deep analysis of a property across multiple objects */
interface PropertyAnalysis {
  key: string;

  /** Primitive types observed: "string", "number", etc. */
  primitiveTypes: Set<string>;

  /** All observed values ​​(for enum detection) */
  stringValues: Set<string>;

  numberValues: Set<number>;

  /** Counters */
  totalObjects: number;
  presentCount: number;
  nullCount: number;

  /** Sub-objects found (for merge) */
  childObjects: Record<string, unknown>[];

  /** Sub-arrays found */
  childArrays: unknown[][];

  /** Whether any value is boolean */
  hasBooleans: boolean;

  /** Boolean values ​​found */
  booleanValues: Set<boolean>;

}

// ============================================================
// ENTRY POINT
// ============================================================

export function jsonToTs(
  jsonString: string,
  partialOptions?: Partial<ConvertOptions>
): string {
  const options: ConvertOptions = { ...DEFAULT_OPTIONS, ...partialOptions };
  const parsed = parseJson(jsonString);
  const interfaces: InterfaceEntry[] = [];
  const enums: EnumEntry[] = [];

  if (Array.isArray(parsed)) {
    handleRootArray(parsed, interfaces, enums, options);
  } else if (typeof parsed === "object" && parsed !== null) {
    resolveType(parsed, options.rootName, interfaces, enums, options);
  } else {
    const type = inferPrimitiveAdvanced(parsed, options);
    const sep = options.useSemicolons ? ";" : "";
    return `${options.addExport ? "export " : ""}type ${options.rootName} = ${type}${sep}`;
  }

  return generateCode(interfaces, enums, options);
}

// ============================================================
// ROOT ARRAY HANDLER
// ============================================================

function handleRootArray(
  arr: unknown[],
  interfaces: InterfaceEntry[],
  enums: EnumEntry[],
  options: ConvertOptions
): void {
  if (arr.length === 0) {
    interfaces.push({
      name: options.rootName,
      properties: [],
      isRootArray: true,
      rootArrayType: "unknown",
      isInline: false,
    });
    return;
  }

  const primitiveTypes = new Set<string>();
  const objectItems: Record<string, unknown>[] = [];
  const arrayItems: unknown[][] = [];
  let hasNull = false;

  for (const item of arr) {
    if (item === null || item === undefined) {
      hasNull = true;
    } else if (Array.isArray(item)) {
      arrayItems.push(item);
    } else if (typeof item === "object") {
      objectItems.push(item as Record<string, unknown>);
    } else {
      primitiveTypes.add(inferPrimitiveAdvanced(item, options));
    }
  }

  // ── Array of objects ──
  if (objectItems.length > 0 && primitiveTypes.size === 0 && arrayItems.length === 0) {
    const analysis = analyzeObjectArray(objectItems);
    const itemName = singularize(options.rootName);

    const properties = resolveAnalyzedProperties(
      analysis,
      itemName,
      interfaces,
      enums,
      options
    );

    if (hasNull) primitiveTypes.add("null");

    const hasSubInterfaces = interfaces.length > 0 || enums.length > 0;
    const propCount = properties.length;

    if (propCount <= 8 && !hasSubInterfaces) {
      interfaces.push({
        name: options.rootName,
        properties,
        isRootArray: true,
        rootArrayType: "",
        isInline: true,
      });
    } else {
      const itemInterfaceName =
        itemName !== options.rootName ? itemName : `${options.rootName}Item`;

      interfaces.push({
        name: itemInterfaceName,
        properties,
        isRootArray: false,
        rootArrayType: "",
        isInline: false,
      });

      interfaces.push({
        name: options.rootName,
        properties: [],
        isRootArray: true,
        rootArrayType: hasNull
          ? `(${itemInterfaceName} | null)`
          : itemInterfaceName,
        isInline: false,
      });
    }
    return;
  }

  // ── Array of primitives ──
  if (objectItems.length === 0 && arrayItems.length === 0) {
    if (hasNull) primitiveTypes.add("null");
    const types = [...primitiveTypes];
    const typeStr = types.length === 1 ? types[0] : `(${types.join(" | ")})`;

    interfaces.push({
      name: options.rootName,
      properties: [],
      isRootArray: true,
      rootArrayType: typeStr,
      isInline: false,
    });
    return;
  }

  // ── Array de arrays ──
  if (objectItems.length === 0 && arrayItems.length > 0 && primitiveTypes.size === 0) {
    const innerTypes = new Set<string>();
    for (const inner of arrayItems) {
      for (const val of inner) {
        if (val === null || val === undefined) {
          innerTypes.add("null");
        } else if (typeof val === "object" && !Array.isArray(val)) {
          innerTypes.add("object");
        } else if (Array.isArray(val)) {
          innerTypes.add("unknown[]");
        } else {
          innerTypes.add(inferPrimitiveAdvanced(val, options));
        }
      }
    }

    const types = [...innerTypes];
    const innerType = types.length === 1 ? types[0] : `(${types.join(" | ")})`;

    interfaces.push({
      name: options.rootName,
      properties: [],
      isRootArray: true,
      rootArrayType: `${innerType}[]`,
      isInline: false,
    });
    return;
  }

  // ── Array mixed ──
  const allTypes: string[] = [...primitiveTypes];
  if (hasNull) allTypes.push("null");

  if (objectItems.length > 0) {
    const itemName = singularize(options.rootName);
    const itemInterfaceName =
      itemName !== options.rootName ? itemName : `${options.rootName}Item`;

    const analysis = analyzeObjectArray(objectItems);
    const properties = resolveAnalyzedProperties(
      analysis,
      itemInterfaceName,
      interfaces,
      enums,
      options
    );

    interfaces.push({
      name: itemInterfaceName,
      properties,
      isRootArray: false,
      rootArrayType: "",
      isInline: false,
    });

    allTypes.push(itemInterfaceName);
  }

  if (arrayItems.length > 0) allTypes.push("unknown[]");

  const typeStr =
    allTypes.length === 1 ? allTypes[0] : `(${allTypes.join(" | ")})`;

  interfaces.push({
    name: options.rootName,
    properties: [],
    isRootArray: true,
    rootArrayType: typeStr,
    isInline: false,
  });
}

// ============================================================
// DEEP ANALYSIS OF OBJECT ARRAYS
// ============================================================

function analyzeObjectArray(
  objects: Record<string, unknown>[]
): Map<string, PropertyAnalysis> {
  const analysis = new Map<string, PropertyAnalysis>();
  const total = objects.length;

  // Collect all keys 
  const allKeys = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      allKeys.add(key);
    }
  }

  // Analyze each key in all objects.
  for (const key of allKeys) {
    const prop: PropertyAnalysis = {
      key,
      primitiveTypes: new Set(),
      stringValues: new Set(),
      numberValues: new Set(),
      totalObjects: total,
      presentCount: 0,
      nullCount: 0,
      childObjects: [],
      childArrays: [],
      hasBooleans: false,
      booleanValues: new Set(),
    };

    for (const obj of objects) {
      if (!(key in obj)) {
        // Key missing in this object.
        continue;
      }

      prop.presentCount++;
      const value = obj[key];

      if (value === null || value === undefined) {
        prop.nullCount++;
        continue;
      }

      if (Array.isArray(value)) {
        prop.primitiveTypes.add("array");
        prop.childArrays.push(value);
        continue;
      }

      if (typeof value === "object") {
        prop.primitiveTypes.add("object");
        prop.childObjects.push(value as Record<string, unknown>);
        continue;
      }

      if (typeof value === "string") {
        prop.primitiveTypes.add("string");
        prop.stringValues.add(value);
      } else if (typeof value === "number") {
        prop.primitiveTypes.add("number");
        prop.numberValues.add(value);
      } else if (typeof value === "boolean") {
        prop.primitiveTypes.add("boolean");
        prop.hasBooleans = true;
        prop.booleanValues.add(value);
      } else if (typeof value === "bigint") {
        prop.primitiveTypes.add("bigint");
      }
    }

    analysis.set(key, prop);
  }

  return analysis;
}

// ============================================================
// RESOLVE ANALYZED PROPERTIES
// ============================================================

function resolveAnalyzedProperties(
  analysis: Map<string, PropertyAnalysis>,
  parentName: string,
  interfaces: InterfaceEntry[],
  enums: EnumEntry[],
  options: ConvertOptions
): PropertyEntry[] {
  const properties: PropertyEntry[] = [];

  for (const [key, prop] of analysis) {
    const childName = `${parentName}${toPascalCase(key)}`;
    const typeFragments: string[] = [];
    let optional = false;

    // ── Smart nullable: distinguish optional vs nullable ──

    if (options.smartNullable) {

      // Missing key in some objects → optional

      if (prop.presentCount < prop.totalObjects) {

        optional = true;

      }

      // Key present but value is null → | null

      if (prop.nullCount > 0 && prop.presentCount > prop.nullCount) {

        // Has non-null values ​​AND null values ​​→ union with null

        // (will be added below)

      } else if (prop.nullCount > 0 && prop.presentCount === prop.nullCount) {

        // ALL present values ​​are null

        typeFragments.push("null");

      }

    } else {

      // Legacy mode: null → optional

      if (prop.presentCount < prop.totalObjects) {

        optional = true;

      }
      if (prop.nullCount > 0) {
        optional = options.optionalNull;
      }
    }
    // ── Solve each primitive type encountered. ──
    for (const primitiveType of prop.primitiveTypes) {
      switch (primitiveType) {
        case "string": {
          const resolved = resolveStringType(
            prop,
            childName,
            enums,
            options
          );
          typeFragments.push(resolved);
          break;
        }

        case "number": {
          const resolved = resolveNumberType(prop, childName, enums, options);
          typeFragments.push(resolved);
          break;
        }

        case "boolean": {
          const resolved = resolveBooleanType(prop);
          typeFragments.push(resolved);
          break;
        }

        case "bigint":
          typeFragments.push("bigint");
          break;

        case "object": {
          if (prop.childObjects.length > 0) {
            const merged = mergeObjects(prop.childObjects);
            // Recursively analyze sub-objects
            const subAnalysis = analyzeObjectArray(prop.childObjects);
            const subProps = resolveAnalyzedProperties(
              subAnalysis,
              childName,
              interfaces,
              enums,
              options
            );

            const existingName = findDuplicateInterface(
              interfaces,
              subProps
            );
            if (existingName) {
              typeFragments.push(existingName);
            } else {
              interfaces.push({
                name: childName,
                properties: subProps,
                isRootArray: false,
                rootArrayType: "",
                isInline: false,
              });
              typeFragments.push(childName);
            }
          }
          break;
        }

        case "array": {
          if (prop.childArrays.length > 0) {
            const allItems = prop.childArrays.flat();
            const arrType = resolveArrayTypeFromValues(
              allItems,
              singularize(childName),
              interfaces,
              enums,
              options
            );
            typeFragments.push(arrType);
          }
          break;
        }
      }
    }

    // If no type resolved and everything is null 
    if (typeFragments.length === 0) {
      if (prop.nullCount > 0) {
        typeFragments.push("null");
      } else {
        typeFragments.push("unknown");
      }
    }

    // ── Add | null if smart nullable ── 
    if (
      options.smartNullable &&
      prop.nullCount > 0 &&
      prop.presentCount > prop.nullCount &&
      !typeFragments.includes("null")
    ) {
      typeFragments.push("null");
    }

    // ── Assemble final type ── 
    // Deduplicate
    const uniqueTypes = [...new Set(typeFragments)];
    const finalType =
      uniqueTypes.length === 1
        ? uniqueTypes[0]
        : uniqueTypes.join(" | ");

    properties.push({
      key: sanitizeKey(key),
      type: finalType,
      optional,
    });
  }

  return properties;
}

// ============================================================
// STRING INFERENCE — Enum detection + Date detection
// ============================================================

function resolveStringType(
  prop: PropertyAnalysis,
  name: string,
  enums: EnumEntry[],
  options: ConvertOptions
): string {
  const values = prop.stringValues;

  // ── Date detection ── 
  if (options.detectDates && values.size > 0) {
    const allDates = [...values].every((v) => isDateString(v));
    if (allDates) {
      return "Date | string";
    }

  }

  // ── Enum detection ──

  if (options.detectEnums && values.size > 0) {

    // Criteria for being an enum:

    // 1. Number of unique values ​​≤ enumMaxValues
    // 2. If there are multiple objects, values ​​must be repeated
    // (total objects > unique values) OR unique values ​​≤ 5

    // 3. Values ​​appear as enums (short, without long spaces)
    const uniqueCount = values.size;
    const looksLikeEnum =
      uniqueCount <= options.enumMaxValues &&
      uniqueCount >= 2 &&
      (prop.totalObjects > uniqueCount || uniqueCount <= 5) &&
      [...values].every((v) => v.length <= 50 && !v.includes("\n"));

    if (looksLikeEnum) {
      if (options.useRealEnums) {
        // Generate real enum
        const enumName = `${name}Enum`;
        const existing = enums.find(
          (e) =>
            e.values.length === values.size &&
            e.values.every((v) => values.has(v))
        );

        if (existing) {
          return existing.name;
        }

        enums.push({ name: enumName, values: [...values].sort() });
        return enumName;
      } else {
        // String literal union
        const literals = [...values]
          .sort()
          .map((v) => `"${escapeString(v)}"`)
          .join(" | ");
        return literals;
      }
    }
  }

  // ── UUID detection ──
  if (values.size > 0) {
    const allUuids = [...values].every((v) => isUUID(v));
    if (allUuids) {
      return "string"; // It could be `\`${string}-${string}...\`` but string is more practical.
    }
  }

  return "string";
}

// ============================================================
// NUMBER INFERENCE — Integer vs Float, Numeric Enum
// ============================================================

function resolveNumberType(
  prop: PropertyAnalysis,
  name: string,
  enums: EnumEntry[],
  options: ConvertOptions
): string {
  const values = prop.numberValues;

  // ── Numeric Enum ──
  if (options.detectEnums && values.size >= 2 && values.size <= options.enumMaxValues) {

    // / If all numbers are small integers and few unique values
    const allIntegers = [...values].every((v) => Number.isInteger(v));
    const fewValues = values.size <= 5 && prop.totalObjects > values.size;

    if (allIntegers && fewValues) {
      const literals = [...values]
        .sort((a, b) => a - b)
        .join(" | ");
      return literals;
    }
  }

  return "number";
}

// ============================================================
// BOOLEAN INFERENCE — true | false literal
// ============================================================

function resolveBooleanType(prop: PropertyAnalysis): string {

  // / If in all objects the boolean is always true or always false

  if (prop.booleanValues.size === 1) {

    const onlyValue = [...prop.booleanValues][0];

    // / Only create a literal if there is a sufficient sample
    if (prop.totalObjects >= 3) {
      return `${onlyValue}`;
    }
  }

  return "boolean";
}

// ============================================================
// RESOLVE ARRAY (enhanced with analysis)
// ============================================================

function resolveArrayTypeFromValues(
  items: unknown[],
  itemName: string,
  interfaces: InterfaceEntry[],
  enums: EnumEntry[],
  options: ConvertOptions
): string {
  if (items.length === 0) return "unknown[]";

  const types = new Set<string>();
  const objectItems: Record<string, unknown>[] = [];

  for (const item of items) {
    if (item === null || item === undefined) {
      types.add("null");
    } else if (Array.isArray(item)) {
      const inner = resolveArrayTypeFromValues(
        item,
        itemName,
        interfaces,
        enums,
        options
      );
      types.add(inner);
    } else if (typeof item === "object") {
      objectItems.push(item as Record<string, unknown>);
    } else {
      types.add(inferPrimitiveAdvanced(item, options));
    }
  }

  if (objectItems.length > 0) {
    const analysis = analyzeObjectArray(objectItems);
    const props = resolveAnalyzedProperties(
      analysis,
      itemName,
      interfaces,
      enums,
      options
    );

    const existingName = findDuplicateInterface(interfaces, props);
    if (existingName) {
      types.add(existingName);
    } else {
      interfaces.push({
        name: itemName,
        properties: props,
        isRootArray: false,
        rootArrayType: "",
        isInline: false,
      });
      types.add(itemName);
    }
  }

  const typeArray = [...types];

  if (typeArray.length === 1) {
    const t = typeArray[0];
    if (t.includes("|") || t.includes("&")) {
      return `(${t})[]`;
    }
    return `${t}[]`;
  }

  return `(${typeArray.join(" | ")})[]`;
}

// ============================================================
// Generic resolution (for standalone objects)
// ============================================================

function resolveType(
  value: unknown,
  name: string,
  interfaces: InterfaceEntry[],
  enums: EnumEntry[],
  options: ConvertOptions
): string {
  if (value === null || value === undefined) return "null";

  if (Array.isArray(value)) {
    return resolveArrayTypeFromValues(
      value,
      singularize(name),
      interfaces,
      enums,
      options
    );
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const properties: PropertyEntry[] = [];

    for (const [key, val] of Object.entries(obj)) {
      const childName = `${name}${toPascalCase(key)}`;
      let type: string;
      let optional = false;

      if (val === null || val === undefined) {
        type = options.smartNullable ? "null" : "unknown";
        optional = options.optionalNull;
      } else {
        type = resolveType(val, childName, interfaces, enums, options);
      }

      properties.push({ key: sanitizeKey(key), type, optional });
    }

    const existingName = findDuplicateInterface(interfaces, properties);
    if (existingName) return existingName;

    interfaces.push({
      name,
      properties,
      isRootArray: false,
      rootArrayType: "",
      isInline: false,
    });

    return name;
  }

  return inferPrimitiveAdvanced(value, options);
}

// ============================================================
// Advanced Primitive Inference
// ============================================================

function inferPrimitiveAdvanced(
  value: unknown,
  options: ConvertOptions
): string {
  if (typeof value === "string") {
    if (options.detectDates && isDateString(value)) {
      return "Date | string";
    }
    return "string";
  }

  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "bigint") return "bigint";

  return "unknown";
}

// ============================================================
// PATTERN DETECTION
// ============================================================

function isDateString(value: string): boolean {
  // ISO 8601
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    const d = new Date(value);
    return !isNaN(d.getTime());
  }

  // "YYYY/MM/DD"
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) {
    const d = new Date(value);
    return !isNaN(d.getTime());
  }

  return false;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

// ============================================================
// PARSE
// ============================================================

function parseJson(input: string): unknown {
  const cleaned = input
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([\]}])/g, "$1");

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const withQuotes = cleaned.replace(
        /(?<=[{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g,
        '"$1":'
      );
      return JSON.parse(withQuotes);
    } catch {
      throw new Error(
        "Invalid JSON. Please check the syntax and try again."
      );
    }
  }
}

// ============================================================
// OBJECT MERGER
// ============================================================

function mergeObjects(
  objects: Record<string, unknown>[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      if (!(key in merged)) {
        merged[key] = value;
      } else if (merged[key] === null && value !== null) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

// ============================================================
// CODE GENERATION
// ============================================================

function generateCode(
  interfaces: InterfaceEntry[],
  enums: EnumEntry[],
  options: ConvertOptions
): string {
  const lines: string[] = [];
  const sep = options.useSemicolons ? ";" : "";
  const indent = " ".repeat(options.indent);
  const exportPrefix = options.addExport ? "export " : "";

  // ── Generate enums first. ──
  for (const enumDef of enums) {
    if (lines.length > 0) lines.push("");

    lines.push(`${exportPrefix}enum ${enumDef.name} {`);
    for (const value of enumDef.values) {
      const enumKey = toEnumKey(value);
      lines.push(`${indent}${enumKey} = "${escapeString(value)}",`);
    }
    lines.push("}");
  }

  // ── Generate interfaces/types ──
  for (const iface of interfaces) {
    if (lines.length > 0) lines.push("");

    // Root array
    if (iface.isRootArray) {
      if (iface.isInline && iface.properties.length > 0) {
        lines.push(`${exportPrefix}type ${iface.name} = {`);
        for (const prop of iface.properties) {
          const opt = prop.optional ? "?" : "";
          lines.push(`${indent}${prop.key}${opt}: ${prop.type}${sep}`);
        }
        lines.push(`}[]${sep}`);
        continue;
      }

      if (iface.rootArrayType) {
        lines.push(
          `${exportPrefix}type ${iface.name} = ${iface.rootArrayType}[]${sep}`
        );
      } else {
        lines.push(
          `${exportPrefix}type ${iface.name} = unknown[]${sep}`
        );
      }
      continue;
    }

    // Normal interface/type
    if (options.useInterface) {
      lines.push(`${exportPrefix}interface ${iface.name} {`);
    } else {
      lines.push(`${exportPrefix}type ${iface.name} = {`);
    }

    for (const prop of iface.properties) {
      const opt = prop.optional ? "?" : "";
      lines.push(`${indent}${prop.key}${opt}: ${prop.type}${sep}`);
    }

    if (options.useInterface) {
      lines.push("}");
    } else {
      lines.push("}" + sep);
    }
  }

  return lines.join("\n");
}

// ============================================================
// UTILITIES
// ============================================================

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function singularize(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("ses") || name.endsWith("xes") || name.endsWith("zes"))
    return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name + "Item";
}

function sanitizeKey(key: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return key;
  return `"${key.replace(/"/g, '\\"')}"`;
}

function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function toEnumKey(value: string): string {
  // "some-value_here" → "SomeValueHere"
  let key = value
    .replace(/[^a-zA-Z0-9_$]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  key = toPascalCase(key);

  // If it starts with a number, add a prefix.
  if (/^\d/.test(key)) {
    key = `_${key}`;
  }

  return key || "_Unknown";
}

function getPrimitiveType(value: unknown): string {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "bigint":
      return "bigint";
    default:
      return "unknown";
  }
}

function findDuplicateInterface(
  interfaces: InterfaceEntry[],
  properties: PropertyEntry[]
): string | null {
  for (const existing of interfaces) {
    if (existing.isRootArray || existing.isInline) continue;
    if (existing.properties.length !== properties.length) continue;

    const allMatch = existing.properties.every((ep, i) => {
      const np = properties[i];
      return (
        ep.key === np.key &&
        ep.type === np.type &&
        ep.optional === np.optional
      );
    });

    if (allMatch) return existing.name;
  }

  return null;
}