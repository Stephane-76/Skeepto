# MongoDB schema — Skeepto

> Source: `DataModel.json` v1.1 + runtime collections (Directory, Spreadsheet, …)  
> Last updated: June 2026

Related files:

| File | Description |
|---------|-------------|
| [`diagrams/database-overview.mmd`](./diagrams/database-overview.mmd) | Mermaid source — ER overview |
| [`diagrams/database-overview.png`](./diagrams/database-overview.png) | PNG export — ER overview |
| [`diagrams/relationship-models.mmd`](./diagrams/relationship-models.mmd) | Mermaid source — relationship models |
| [`diagrams/relationship-models.png`](./diagrams/relationship-models.png) | PNG export — relationship models |

---

## 1. Collection overview

![Collection overview](./diagrams/database-overview.png)

```mermaid
erDiagram
    Group ||--o{ User : "FK Group.Code"
    RelationshipType ||--o{ Relationship : "FK RelationshipType.Code"
    User ||--o{ Relationship : "graph FromId / ToId"
    Group ||--o{ Relationship : "graph FromId / ToId"
    User ||--o{ Directory : "owner (email)"
    Group ||--o{ Directory : "group (code)"
    Directory ||--o| Spreadsheet : "record (_id)"
    Directory ||--o{ Directory : "parentId"
    Spreadsheet ||--o{ SpreadsheetHistory : "recordId"
    Directory ||--o{ SpreadsheetHistory : "path"

    Group {
        string Code PK
        string Label
        string Rules
        ObjectId _id
    }

    User {
        string Email PK
        string Name
        string FirstName
        string Group FK
        string Password
        string PassWord
        date Date
        ObjectId _id
    }

    RelationshipType {
        string Code PK
        string Label
        string FromTypes
        string ToTypes
        ObjectId _id
    }

    Relationship {
        string Code PK
        string FromType
        string FromId
        string ToType
        string ToId
        string RelationshipType FK
        date Date
        string Props
        ObjectId _id
    }

    Directory {
        ObjectId _id PK
        string name
        string path
        string content
        ObjectId gridfsId
        number size
        string owner
        string group
        boolean isDirectory
        ObjectId parentId
        ObjectId record
        object info
        number permissions
        date createdAt
        date updatedAt
    }

    Spreadsheet {
        ObjectId _id PK
        string dataJson
        ObjectId gridfsId
        number size
        date createdAt
        date updatedAt
    }

    SpreadsheetHistory {
        ObjectId _id PK
        string path
        ObjectId recordId
        number revision
        string label
        string comment
        object data
        number size
        string author
        string email
        string source
        string contentHash
        date createdAt
    }
```

### Legend

| Symbol | Meaning |
|---------|---------------|
| **PK** | Business primary key (metamodel) or MongoDB `_id` |
| **FK** | Foreign key validated by `SkGenericDb` |
| **graph** | Link via `Relationship.FromType/FromId` → `ToType/ToId` |

### Collections by layer

| Layer | Collections | API |
|--------|-------------|-----|
| **DataModel** | `User`, `Group`, `Relationship`, `RelationshipType` | `POST/GET/DELETE /mdb/:table` |
| **Runtime** | `Directory`, `Spreadsheet`, `SpreadsheetHistory` | `/files/...`, `.sker` save |
| **Binary** | GridFS (`fs.files`, `fs.chunks`) | via `gridfsId` |

---

## 2. Two relationship models

![Two relationship models](./diagrams/relationship-models.png)

```mermaid
flowchart TB
    subgraph rigide ["Rigid links — DataModel FK"]
        U["User.Group"] --> G["Group.Code"]
        R["Relationship.RelationshipType"] --> RT["RelationshipType.Code"]
    end

    subgraph graphe ["Soft links — Relationship graph"]
        RF["FromType + FromId"] --> E1["Any metamodel entity"]
        RT2["ToType + ToId"] --> E2["Any metamodel entity"]
        RT3["RelationshipType"] --> RF
        RT3 --> RT2
    end

    subgraph exemple ["memberOf example"]
        U2["User\nEmail: lallez@toto.fr"] -->|"memberOf"| G2["Group\nCode: admin"]
    end
```

### Comparison

| Type | Mechanism | Integrity | Typical use |
|------|-----------|-----------|---------------|
| **Classic FK** | Column → referenced table | Validated on every insert/update | Required structure (`User` ∈ `Group`) |
| **Relationship** | `FromType/FromId` → `ToType/ToId` + `RelationshipType` | Validated by catalog type + entity existence | Generic business links, with history (`date`, `Props`) |

---

## References

- Declarative definition: [`DataModel.json`](./DataModel.json)
- Metamodel documentation: [`DOCUMENTATION_DATAMODEL_METAMODEL.md`](../DOCUMENTATION_DATAMODEL_METAMODEL.md)
- Virtual disk: [`SkVirtualDiskDb.mjs`](../SkVirtualDisk/SkVirtualDiskDb.mjs)
- `.sker` storage: [`SkSkerStorage.mjs`](../SkSpreadSheet/SkSkerStorage.mjs)
