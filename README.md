# State of State Management — The Rise of Graph-based Approaches

> A comparison and outlook on state management architectures in frontend and mobile development (March 2026)

---

## Introduction

In frontend and mobile development, the question of **how to manage state dependencies** is once again in the spotlight. Against the backdrop of traditional **push-based** state management — exemplified by ViewModels and simple stores — a new paradigm is gaining traction across platforms: **graph-based** state management, which automatically manages dependencies as a directed acyclic graph (DAG).

This report compares the design philosophies, internal architectures, and code styles of major libraries across Web, iOS, and Android.

---

## Push-based vs Graph-based

### Push-based (The Traditional Mainstream)

When state changes, all subscribers are notified. The developer must manually wire up which state depends on which.

- Typical examples: StateFlow's `combine`, RxJS's `combineLatest`
- As the app grows more complex, the number of wiring connections increases, making dependency tracking difficult
- Representatives: ViewModel + StateFlow (Android), Redux (Web)

### Graph-based (On the Rise)

The runtime (or compiler) automatically manages dependency relationships between state nodes. The act of "reading" a state value itself registers the dependency, and changes propagate only to the affected scope.

- Dependency graph is constructed automatically
- Only the affected range is recalculated (fine-grained updates)
- Representatives: Jotai (Web), swift-state-graph (iOS)

---

## Three Styles of Dependency Tracking

While "graph-based" is often used as a blanket term, the way dependencies are tracked differs significantly.

### 1. Automatic / Implicit Tracking

The act of "reading" a state node automatically registers a dependency. Developers don't need to think about dependency relationships at all.

- **Jotai**: `atom(get => get(otherAtom))` — dependency tracked at `get()` call time
- **swift-state-graph**: Uses ThreadLocal to observe access and automatically discover dependencies
- **Jetpack Compose**: The Snapshot system tracks State reads within `derivedStateOf {}` blocks

### 2. Explicit Tracking

The developer declares which nodes are depended upon via a `deps` array. This avoids the implicitness of automatic tracking and keeps dependencies visible.

- **TanStack Store**: `new Derived({ deps: [storeA, storeB], fn: ... })`

### 3. No Tracking (Subscription-based)

No dependency graph exists. The developer individually specifies "which changes to care about" using selectors.

- **Zustand**: `useStore(state => state.count)` — compares the selector's return value with `Object.is`

---

## Library Deep Dives

---

### Zustand — The Gold Standard of Subscription-based

- **Repository**: https://github.com/pmndrs/zustand
- **Language**: TypeScript
- **Framework**: React (Vanilla Core is framework-agnostic)

#### Architecture

Designed with a two-layer structure:

1. **Vanilla Core layer** (`vanilla.ts`): Framework-agnostic state management. Internally uses a simple `Set<Listener>` subscription pattern
2. **React integration layer** (`react.ts`): React hooks powered by `useSyncExternalStore`

#### Dependency Tracking

**Does not track dependencies** — this is an intentional design decision. When state changes, all listeners are notified, and each listener compares the selector's return value using `Object.is` to determine whether re-rendering is needed.

#### Derived State

There is no dedicated mechanism within the store. Derived values are computed inside selector functions on the component side.

```typescript
// Store definition — single object
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}))

// Derived value computed via selector (no graph in the store)
const doubled = useStore((state) => state.bears * 2)
```

#### Strengths

- Extremely lightweight at ~2KB bundle size
- Low learning curve; implementation is simple and predictable
- No Provider needed (store is a singleton)
- Extensible via middleware (persist, devtools, immer, etc.)

#### Limitations

- When states have complex interdependencies, manually managing selectors becomes burdensome
- "Which state affects which" is hard to trace in the code

---

### Jotai — Automatic Atom Graph

- **Repository**: https://github.com/pmndrs/jotai
- **Language**: TypeScript
- **Framework**: React

#### Architecture

A **bottom-up** design with atoms as the smallest unit. Small atoms are composed to build a dependency graph.

#### Dependency Tracking

The runtime automatically tracks dependencies at `get()` call time in `atom(get => get(otherAtom))`. The dependency graph is refreshed on every read function execution, so it also handles dynamic dependencies from conditional branches.

#### Dependency Graph Management

- If Atom B depends on Atom A, then A is B's **dependency**, and B is A's **dependent**
- On first use, the read function executes and establishes dependency relationships
- Dependents are added to the dependency's `dependents` set

#### Derived State

A derived atom is defined as an atom that depends on other atoms' values. By specifying a write function, it can also become a writable derived atom.

```javascript
// Base atom
const countAtom = atom(0)

// Derived atom — get() auto-registers dependencies
const doubledAtom = atom((get) => get(countAtom) * 2)

// Writable derived atom
const decrementAtom = atom(
  (get) => get(countAtom),
  (get, set) => set(countAtom, get(countAtom) - 1)
)
```

#### Relationship with Recoil

Shares the same atom-based philosophy as Meta's Recoil (2020), but Jotai achieves equivalent functionality with a simpler API. Recoil's maintenance has stagnated, and Jotai is becoming the de facto standard in this space.

#### Strengths

- No manual dependency wiring needed
- Solves React Context's excessive re-rendering problem
- Delivers a Signals-like development experience within a declarative programming model

---

### TanStack Store — Explicit Graph-based

- **Repository**: https://github.com/TanStack/store
- **Language**: TypeScript
- **Framework**: React, Vue, Solid, Angular, Svelte

#### Architecture

Built on three core primitives:

1. **Store**: Mutable state container with immutable updates via `setState()`
2. **Derived**: Lazily evaluated computed values that auto-recalculate when dependencies change
3. **Effect**: Side-effect management with automatic dependency tracking and cleanup

#### Dependency Tracking

Maintains a **bidirectional dependency map** internally:

- `__storeToDerived`: Store → Derived dependency map
- `__derivedToStore`: Derived → Store reverse reference map

However, registering dependencies requires **explicit declaration** via a `deps` array — unlike Jotai's implicit automatic tracking.

#### Derived State

```typescript
const countStore = new Store(0)

const doubled = new Derived({
  deps: [countStore],       // ← Dependencies declared explicitly
  fn: () => countStore.state * 2,
})
```

The computation function has access to `prevVal`, `prevDepVals`, and `currDepVals`, enabling state change history tracking.

#### Batch Updates

The `batch()` function aggregates multiple updates to prevent unnecessary intermediate renders. The internal `__flush()` mechanism traverses the dependency graph to propagate updates efficiently.

#### Strengths

- Dependencies are immediately visible in the `deps` array
- Framework-agnostic (serves as the foundation for the entire TanStack ecosystem)
- Effects are separated as a dedicated class

---

### swift-state-graph — Jotai for iOS

- **Repository**: https://github.com/VergeGroup/swift-state-graph
- **Language**: Swift 6.0+
- **Framework**: SwiftUI, UIKit
- **Requirements**: iOS 17+

#### Architecture

DAG-based reactive state management. Nodes represent state containers, and edges represent dependency relationships. A Swift port of the design philosophy from Jotai and Recoil.

#### Two Types of Nodes

1. **Stored\<Value\>** (`@GraphStored`): Mutable state node (source node)
2. **Computed\<Value\>** (`@GraphComputed`): Read-only derived state node

#### Dependency Tracking

Performs **runtime automatic dependency discovery**:

1. `withGraphTracking` establishes a `ThreadLocal<TrackingContext>`
2. On `wrappedValue` access, the context is checked
3. Edges are recorded automatically (source → consumer)
4. Dependencies are dynamically determined by accesses within the computation closure

This follows the same philosophy as Jotai's `get()` auto-tracking, but uses Swift's ThreadLocal instead.

#### Change Propagation

Employs a **lazy invalidation pattern**:

1. When a `Stored` value changes, immediately dirty-marks downstream dependent nodes
2. Computed nodes are not executed — only the invalid flag is set
3. Recalculation happens only on `wrappedValue` access (lazy evaluation)
4. Multiple consecutive changes avoid unnecessary recalculations

#### Macros for Code Generation

Leverages Swift 6.0 macros to minimize boilerplate:

```swift
@GraphStored var count: Int = 0
// ↑ The macro auto-expands hidden $backing storage and get/set accessors

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

#### Storage Abstraction

Unlike Jotai/Recoil, swift-state-graph natively supports **persistence via the Storage protocol**:

- `InMemoryStorage` (default)
- `UserDefaultsStorage` (automatic persistence)
- Custom implementations possible

```swift
@GraphStored(backed: .userDefaults(key: "theme")) var theme: Theme = .light
```

#### Thread Safety

Each node holds an `OSAllocatedUnfairLock` for atomic operations. Maintains actor isolation within tracking callbacks while preserving `@MainActor` isolation — essential in a Swift Concurrency environment, unlike JavaScript's single-threaded model.

#### Strengths

- Achieves Jotai-equivalent automatic dependency tracking natively in Swift
- Declarative syntax via macros
- Per-node locking for concurrency safety
- Native persistence support

---

### Android — A Mix of Push and Graph

#### Mainstream: ViewModel + StateFlow (Push-based)

On Android, the combination of ViewModel + StateFlow + Jetpack Compose — officially promoted by Google — has become the industry standard.

```kotlin
// Typical push-based pattern
val isLoading: StateFlow<Boolean>
val user: StateFlow<User?>
val posts: StateFlow<List<Post>>

// Every combination requires combine (manual wiring)
val uiState = combine(isLoading, user, posts) { loading, user, posts ->
    UiState(loading, user, posts)
}

// As derived states grow, the wiring expands
val filteredPosts = combine(posts, searchQuery) { posts, query -> ... }
val badge = combine(filteredPosts, user) { ... }
```

#### Jetpack Compose's `derivedStateOf` (Graph-based in the UI Layer)

Compose itself achieves graph-based dependency tracking within the UI layer:

```kotlin
val list = remember { mutableStateListOf<Item>() }
val count by remember {
    derivedStateOf { list.count { it.done } }
    // ↑ State reads inside the block automatically build the dependency graph
}
```

Internally, it uses the Snapshot system with the following mechanisms:

- Auto-tracks State object reads within `derivedStateOf {}` blocks
- Derived states reading other derived states form a DAG
- Even when a dependency is written to, recomposition is suppressed if the computed result doesn't change (conditional invalidation)
- `DerivedStateObserver` interface manages nested dependency trees

However, this is strictly **UI-layer (Compose) only** — it doesn't apply to the business logic layer.

#### ReactiveState-Kotlin (Graph-based for Business Logic)

```kotlin
val base = MutableStateFlow(0)
val extra = MutableStateFlow(0)

// get() call auto-tracks dependencies — same philosophy as Jotai's atom(get => ...)
val sum: StateFlow<Int> = derived { get(base) + get(extra) }

autoRun {
    if (get(sum) > 10) alert("too high")  // Automatically subscribes to sum's changes
}
```

Kotlin Multiplatform compatible for use across Android/iOS, but not yet a mainstream choice.

#### Why Graph-based Libraries Haven't Taken Off on Android

1. **Google's official push**: The push-based ecosystem from LiveData → StateFlow is deeply entrenched
2. **MVI/MVVM entrenchment**: The architecture of "ViewModel emits a single state" is the industry standard
3. **Kotlin Coroutines/Flow**: Powerful push-based tools exist at the language level
4. **Compose partially solves it**: Fine-grained UI-layer reactivity is already handled by `derivedStateOf`

---

## Comparison Table

| | **Zustand** | **Jotai** | **TanStack Store** | **swift-state-graph** | **Compose derivedStateOf** |
|---|---|---|---|---|---|
| Paradigm | Subscription | Graph | Graph | Graph | Graph (UI layer) |
| Dep. Tracking | None (selectors) | Auto / implicit | Explicit (deps) | Auto / implicit | Auto / implicit |
| Primitive | Single Store | Atom (distributed) | Store + Derived + Effect | Stored + Computed | State + derivedStateOf |
| Design Dir. | Top-down | Bottom-up | Top-down | Bottom-up | Top-down |
| Evaluation | Eager notify | On-demand | Lazy | Lazy invalidation | Conditional invalidation |
| Side Effects | Middleware | External libs | Effect class | withGraphTracking | LaunchedEffect |
| Persistence | persist middleware | Plugin | Plugin | Native (Storage protocol) | — |
| Thread Safety | — (JS) | — (JS) | — (JS) | Per-node lock | Snapshot system |
| Bundle Size | ~2KB | ~3KB | ~3KB | — | Built into Compose |
| Frameworks | React | React | React/Vue/Solid/Angular/Svelte | SwiftUI/UIKit | Jetpack Compose |
| Language | TypeScript | TypeScript | TypeScript | Swift 6.0 | Kotlin |

---

## Code Style Comparison

Below is the same operation — **deriving `doubled` from `count`** — written in each library.

### Zustand (Subscription / Selector)

```typescript
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

// Derived value computed via selector on the component side
const doubled = useStore((state) => state.count * 2)
```

### Jotai (Implicit Graph)

```javascript
const countAtom = atom(0)
const doubledAtom = atom((get) => get(countAtom) * 2)
// get() call auto-registers the dependency. No wiring needed.
```

### TanStack Store (Explicit Graph)

```typescript
const countStore = new Store(0)
const doubled = new Derived({
  deps: [countStore],          // ← Dependencies declared explicitly
  fn: () => countStore.state * 2,
})
```

### swift-state-graph (Swift Macros + Auto-tracking)

```swift
@GraphStored var count: Int = 0

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

### Jetpack Compose (UI-layer Auto-tracking)

```kotlin
var count by remember { mutableIntStateOf(0) }
val doubled by remember {
  derivedStateOf { count * 2 }
  // Reading count automatically registers the dependency
}
```

### StateFlow combine (Android Manual Wiring)

```kotlin
val count = MutableStateFlow(0)
val doubled = count.map { it * 2 }  // Dependency specified manually
```

---

## Relationship with Signals

In the web frontend world, the concept of **Signals** is rapidly gaining adoption — Angular (v16+), SolidJS, Vue 3 (ref/computed), and a TC39 standardization proposal are all advancing simultaneously from different directions.

Signals and graph-based state management are philosophically aligned:

- **Fine-grained change detection**: State changes propagate only to the affected scope
- **Lazy evaluation**: Even when dependencies change, recalculation doesn't happen until the value is actually read
- **Automatic dependency tracking**: The act of "reading" a value registers the dependency

Jotai positions itself as delivering "a Signals-like development experience in React, within a declarative programming model." swift-state-graph follows the same lineage. TanStack Store is less implicit than Signals, but shares the goal of fine-grained updates.

Zustand deliberately keeps its distance from this trend, centering its design on the principle of "don't make state management complicated."

---

## Why This Paradigm Is Spreading Now

### Application Complexity

As the number of states grows and their interdependencies multiply, the cost of manual wiring (`combine`, `combineLatest`, etc.) accumulates. Graph-based approaches attempt to solve this problem fundamentally through "automatic dependency tracking."

### Performance Demands

Fine-grained updates happen automatically, avoiding unnecessary re-renders and recalculations. This also serves as one answer to React's Context API problem, where "all components under a Provider re-render."

### Affinity with Declarative UI

SwiftUI, Jetpack Compose, and React are all declarative UI frameworks. Given the premise that "UI updates automatically when state changes," it's a natural extension for state interdependencies to also be tracked automatically.

### Cross-platform Convergence

Web (Jotai, Signals), iOS (swift-state-graph), and Android (Compose `derivedStateOf`) — different platforms are independently heading in the same direction. This should be understood not as a single library trend, but as a paradigm shift across the entire state management domain.

---

## Conclusion

State management design broadly divides into **subscription-based** and **graph-based** approaches.

**Subscription-based** (Zustand) continues to be widely used, leveraging simplicity and predictability as its strengths. For small to medium-sized applications, this approach is more than sufficient, and the low learning curve is a major advantage.

**Graph-based** (Jotai, TanStack Store, swift-state-graph) becomes increasingly beneficial as state complexity grows. By automatically tracking dependencies, it reduces wiring costs and prevents unnecessary recalculations through fine-grained updates. On the web, Jotai realizes this approach; on iOS, swift-state-graph does the same; and on Android, Compose's `derivedStateOf` partially adopts it.

The philosophy of **"automatically tracking dependencies and propagating state with minimal recalculation"** is becoming the shared direction of state management across platforms.

---

## References

- [Zustand](https://github.com/pmndrs/zustand) — pmndrs
- [Jotai](https://github.com/pmndrs/jotai) — pmndrs
- [TanStack Store](https://github.com/TanStack/store) — TanStack
- [swift-state-graph](https://github.com/VergeGroup/swift-state-graph) — VergeGroup
- [Jetpack Compose State](https://developer.android.com/develop/ui/compose/state) — Android Developers
- [ReactiveState-Kotlin](https://github.com/ensody/ReactiveState-Kotlin) — ensody
- [Jotai Core Internals](https://jotai.org/docs/guides/core-internals)
- [How derivedStateOf works](https://blog.zachklipp.com/how-derivedstateof-works-a-deep-d-er-ive/) — Zach Klipp
