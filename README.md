# State of State Management

> A comparison and outlook on state management architectures in frontend and mobile development (March 2026)

---

## Introduction

In frontend and mobile development, the question of **how to manage state** continues to evolve. This report organizes the landscape along two independent axes:

1. **Push vs Pull** — how state changes flow to consumers
2. **Graph-based dependency tracking** — a technique for managing derived state, applicable to either push or pull systems

The previous version of this report framed the discussion as "Push vs Graph." This was imprecise. Push and Pull describe the **direction of data flow**. Graph describes **how derived state dependencies are managed** — and it can appear in both push and pull architectures.

---

## Axis 1: Push vs Pull

### Push-based

The source of truth actively **pushes** state changes to subscribers. When a mutation occurs, all registered listeners are notified immediately.

- The store owns the notification responsibility
- Subscribers are passive recipients
- Derived state is typically computed eagerly when source state changes
- Representatives: **Verge**, **TCA**, **Zustand**, **Redux**, ViewModel + StateFlow

### Pull-based

Consumers **pull** (read) state on demand. The system tracks what was accessed and recalculates only when needed.

- Consumers drive computation by accessing values
- Derived state is evaluated lazily — only when read
- The system must track "who read what" to know when to invalidate
- Representatives: **Jotai**, **swift-state-graph**, **Signals** (SolidJS, Angular, Vue)

### The Key Difference

In a push system, the producer says: *"I changed — everyone, here's the new value."*
In a pull system, the consumer says: *"I need this value — let me check if it's still valid."*

Both approaches are valid. Push systems are simpler to reason about and debug. Pull systems offer finer-grained update control and avoid unnecessary computations.

### Inherent Challenges of Push-based Systems

Push-based architectures — where the store immediately pushes the latest value to all subscribers on every mutation — carry several non-trivial challenges that grow with application complexity.

#### Backpressure

When the producer mutates state faster than consumers can process, push systems have no built-in mechanism to throttle the flow. Every `setState` / `commit` immediately triggers notification to all subscribers.

In practice, this manifests as:
- Rapid successive mutations flooding the UI with intermediate states
- Subscribers receiving values they never have time to render before the next one arrives
- Performance degradation under high-frequency updates (e.g., drag gestures, real-time data streams)

Solutions like `batch()` (TanStack Store), debouncing, or `conflate` (Kotlin Flow) are workarounds — they add complexity to compensate for what is fundamentally a producer-driven flow control problem.

Pull-based systems sidestep this entirely: since derived values are only computed when read, intermediate mutations are naturally coalesced. The consumer only ever sees the latest value at the time of access.

#### Recursive / Reentrant Updates

When a state change notification triggers a subscriber that itself mutates state, a recursive cycle can occur:

```
State A changes → notify subscriber → subscriber mutates State B
→ notify subscriber → subscriber mutates State A → ...
```

This is a fundamental problem of synchronous push notification. If subscriber callbacks are invoked inline during `setState`, a mutation inside a callback can trigger another round of notifications **on the same call stack**, leading to:

- **Stack overflow** from deeply nested notification chains
- **Inconsistent intermediate states** observed by subscribers mid-cascade
- **Glitches** where a subscriber sees a partially-updated world (State A is new, State B is still old)

#### The Need for Trampolining

To prevent stack overflow from recursive dispatch, push-based systems often employ a **trampoline** — a mechanism that defers nested state updates instead of executing them immediately on the same call stack.

The pattern works like this:

1. A mutation begins → notifications are dispatched
2. If a subscriber triggers another mutation during notification, the new mutation is **queued** instead of executed immediately
3. After the current notification round completes, the queue is drained
4. This continues until the queue is empty

TCA implements this via action buffering — actions sent during reducer execution are enqueued and processed sequentially. Verge processes commits synchronously but relies on Swift's actor isolation to prevent reentrant access. Redux enforces the rule that dispatching inside a reducer is an error.

The trampoline adds correctness but also adds complexity and indirection. The developer must reason about **when** a state change actually takes effect — it may not be immediate if it was enqueued.

#### The Glitch Problem

In a push system with derived state, there is a window during cascading updates where some derived values reflect the new source state and others still reflect the old one. This is known as **glitching**.

```
Source A changes → Derived X (depends on A, B) is recomputed with new A, old B
                 → Derived Y (depends on A) is recomputed with new A
                 → Source B changes → Derived X is recomputed again with new A, new B
```

Derived X was briefly in an inconsistent state — computed from a mix of old and new values. In UI applications, this can cause visual flickering or briefly incorrect displays.

Pull-based systems with lazy evaluation avoid this: since derived values are only computed on access (after all source mutations are complete), they always see a consistent snapshot of their dependencies.

#### Summary of Push Challenges

| Challenge | Cause | Typical Workaround | Pull-based Equivalent |
|---|---|---|---|
| Backpressure | Producer faster than consumer | batch, debounce, conflate | N/A (lazy by nature) |
| Recursive dispatch | Mutation inside notification | Trampoline / queue | N/A (no inline notification) |
| Stack overflow | Deep synchronous notification chains | Trampoline / async dispatch | N/A (compute on access) |
| Glitching | Partial propagation of cascading updates | Batch / transaction | Consistent snapshot on read |

These challenges are not fatal — mature push-based libraries have well-tested solutions. But they represent inherent complexity that the push model must manage, whereas pull-based systems avoid these categories of problems by design.

---

## Axis 2: Graph-based Dependency Tracking

**Every state management system needs derived state.** Whether push or pull, applications inevitably need to compute values from other values — filtered lists, aggregated counts, combined UI states.

The question is: **how are the dependencies between source and derived state managed?**

### Manual Wiring

The developer explicitly specifies which states to combine.

```kotlin
// Android StateFlow — manual wiring
val uiState = combine(isLoading, user, posts) { loading, user, posts ->
    UiState(loading, user, posts)
}
```

```typescript
// Zustand — selector on the consumer side
const doubled = useStore((state) => state.count * 2)
```

### Graph-based Tracking

A dependency graph (DAG) is constructed — either automatically or declaratively — to manage which derived states depend on which source states. When a source changes, the graph determines the minimal set of derived states to recompute or invalidate.

This technique appears in **both push and pull systems**:

- **Push + Graph**: TanStack Store (`Derived` with explicit `deps`), Verge (`Derived` with pipeline)
- **Pull + Graph**: Jotai (implicit tracking via `get()`), swift-state-graph (implicit tracking via ThreadLocal), Compose `derivedStateOf`

The graph is not a paradigm — it is a **technique** for managing derived state efficiently.

---

## Library Deep Dives

---

### Verge — Push-based with Tracking and Derived

- **Repository**: https://github.com/VergeGroup/swift-verge
- **Language**: Swift
- **Framework**: SwiftUI, UIKit
- **Paradigm**: Push-based, unidirectional data flow (Flux-inspired)

#### Architecture

Verge is a push-based state management framework built on unidirectional data flow. The `Store` holds the single source of truth, and mutations flow through `commit` blocks.

```
Action → store.commit { ... } → State mutation → Changes<State> → Subscriber notification
```

#### State Update Flow

1. Client calls `store.commit { $0.count += 1 }`
2. `InoutRef` wrapper tracks which properties were modified
3. `Changes<State>` object is created, containing old and new state plus modification info
4. `EventEmitter` pushes the change to all subscribers

This is fundamentally push-driven — state changes are immediately broadcast to all subscribers.

#### Derived State

Verge provides `Derived<Value>` via a pipeline-based transformation:

```
Store → Derived<Value>
       ↓
      Pipeline (select / map / filter)
       ↓
      Computed value delivery
```

`store.derived(.select(\.count))` creates a derived that updates only when `count` changes. `BindingDerived` supports bidirectional binding when write-back is needed.

#### @Tracking Macro

The `@Tracking` macro generates property-access tracking infrastructure on state structs. Combined with `ifChanged()`, UI components can check whether specific properties have changed — enabling fine-grained update filtering within a push architecture.

#### @Edge Property Wrapper

For types that are not `Equatable` or expensive to compare, `@Edge` provides version-counter-based efficient tracking.

#### Strengths

- Simple mental model: commit-based mutation without action/reducer ceremony
- `@Tracking` + `ifChanged()` enables fine-grained filtering within push
- Middleware support for interception, validation, logging
- Thread-safe via `swift-atomics` and `TaskManagerActor`
- Multiple product variants (Verge, VergeTiny, VergeNormalizationDerived, VergeRx)

---

### TCA (The Composable Architecture) — Push-based with Reducer Composition

- **Repository**: https://github.com/pointfreeco/swift-composable-architecture
- **Language**: Swift
- **Framework**: SwiftUI
- **Paradigm**: Push-based, unidirectional (Elm-inspired)

#### Architecture

TCA is built on four core concepts forming a unidirectional cycle:

```
User Action → Store.send() → Reducer → State mutation + Effects
                                ↓
                          View re-render (push)
```

#### State Update Flow

1. User interaction triggers `store.send(action)`
2. The reducer processes the action and returns new state + effects
3. State change is automatically pushed to the view via `@ObservableState`
4. Effects run asynchronously and may feed new actions back into the cycle

Action buffering prevents reentrant dispatch — actions sent during reducer execution are queued and processed in order.

#### Derived State

TCA handles derived state within the reducer or as computed properties on the state struct. The guidance is:

- Computation-heavy work should run in **effects** (off main thread), not in reducers
- Shared logic should use **helper methods** on the reducer, not action dispatch
- Simple derivations can be computed properties on the `State` struct

There is no dedicated graph-based derived state mechanism — derivation is manual and explicit.

#### Reducer Composition

The defining feature of TCA. Complex features are decomposed into smaller domains:

```swift
Reduce { state, action in ... }
  Scope(state: \.child, action: \.child) {
    ChildReducer()
  }
```

- `Scope`: Maps parent state/action to child
- `ifLet`: Tree-based navigation with optional state
- `forEach`: Stack-based navigation with collection state

#### Store Scoping

```swift
let childStore = store.scope(state: \.child, action: \.child)
```

Scoped stores ensure child views only see their own domain, improving both modularity and performance (unrelated state changes don't trigger re-renders).

#### Strengths

- Highly structured and testable (`TestStore` for exhaustive state/effect verification)
- Powerful composition model for large-scale applications
- Strong ecosystem (navigation, dependencies, sharing)
- Predictable: all state changes are traceable through actions

#### Trade-offs

- Significant boilerplate (Action enum, Reducer body, State struct)
- No automatic dependency tracking for derived state
- Learning curve is steep compared to simpler approaches

---

### Zustand — Push-based, Minimal

- **Repository**: https://github.com/pmndrs/zustand
- **Language**: TypeScript
- **Framework**: React (Vanilla Core is framework-agnostic)
- **Paradigm**: Push-based (simple subscription)

#### Architecture

Two-layer design:

1. **Vanilla Core** (`vanilla.ts`): `Set<Listener>` subscription pattern, framework-agnostic
2. **React integration** (`react.ts`): `useSyncExternalStore` hooks

#### Dependency Tracking

**None** — intentionally. All listeners are notified on every state change. Each listener's selector return value is compared via `Object.is` to determine re-render necessity.

#### Derived State

No store-level mechanism. Derived values are computed in selectors on the component side.

```typescript
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}))

// Derived value via selector (no graph)
const doubled = useStore((state) => state.bears * 2)
```

#### Strengths

- ~2KB bundle, extremely lightweight
- Low learning curve, simple and predictable
- No Provider needed (singleton stores)
- Extensible via middleware (persist, devtools, immer)

#### Limitations

- Manual selector management becomes burdensome with complex interdependencies
- No way to trace "which state affects which" at the framework level

---

### Jotai — Pull-based with Implicit Graph

- **Repository**: https://github.com/pmndrs/jotai
- **Language**: TypeScript
- **Framework**: React
- **Paradigm**: Pull-based, automatic graph

#### Architecture

Bottom-up design with **atoms** as the smallest unit. Small atoms are composed to build a dependency graph.

#### Dependency Tracking

The runtime automatically tracks dependencies at `get()` call time. The graph is refreshed on every read function execution, handling dynamic dependencies from conditional branches.

- If Atom B depends on Atom A, then A is B's **dependency** and B is A's **dependent**
- On first use, the read function executes and establishes relationships
- Dependents are added to the dependency's `dependents` set

#### Derived State

```javascript
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

Shares the same atom-based philosophy as Meta's Recoil (2020), but achieves equivalent functionality with a simpler API. Recoil's maintenance has stagnated; Jotai is the de facto standard in this space.

#### Strengths

- No manual dependency wiring
- Solves React Context's excessive re-rendering problem
- Signals-like development experience within a declarative model

---

### TanStack Store — Push-based with Explicit Graph

- **Repository**: https://github.com/TanStack/store
- **Language**: TypeScript
- **Framework**: React, Vue, Solid, Angular, Svelte
- **Paradigm**: Push-based with graph-tracked derived state

#### Architecture

Three core primitives:

1. **Store**: Mutable state container with `setState()`
2. **Derived**: Lazily evaluated computed values with explicit dependency declaration
3. **Effect**: Side-effect management with dependency tracking and cleanup

#### Dependency Tracking

Maintains a **bidirectional dependency map**:

- `__storeToDerived`: Store → Derived
- `__derivedToStore`: Derived → Store

Dependencies are registered via **explicit `deps` array** — not implicit auto-tracking.

#### Derived State

```typescript
const countStore = new Store(0)

const doubled = new Derived({
  deps: [countStore],       // ← Explicit declaration
  fn: () => countStore.state * 2,
})
```

The `batch()` function aggregates updates; the internal `__flush()` traverses the dependency graph for efficient propagation.

#### Strengths

- Dependencies visible at a glance in `deps`
- Framework-agnostic (foundation of TanStack ecosystem)
- Effects as a dedicated, first-class concept

---

### swift-state-graph — Pull-based with Implicit Graph

- **Repository**: https://github.com/VergeGroup/swift-state-graph
- **Language**: Swift 6.0+
- **Framework**: SwiftUI, UIKit
- **Requirements**: iOS 17+
- **Paradigm**: Pull-based, automatic graph (Jotai for Swift)

#### Architecture

DAG-based reactive state management. Nodes are state containers, edges are dependency relationships.

#### Two Types of Nodes

1. **Stored\<Value\>** (`@GraphStored`): Mutable source node
2. **Computed\<Value\>** (`@GraphComputed`): Read-only derived node

#### Dependency Tracking

Runtime automatic dependency discovery:

1. `withGraphTracking` sets up `ThreadLocal<TrackingContext>`
2. On `wrappedValue` access, the context is checked
3. Edges are recorded automatically (source → consumer)
4. Dependencies are dynamically determined by accesses within computation closures

#### Change Propagation

Lazy invalidation pattern:

1. `Stored` value changes → downstream nodes are dirty-marked
2. Computed nodes are **not** executed — only flagged invalid
3. Recalculation happens only on `wrappedValue` access (lazy/pull)
4. Consecutive changes avoid redundant recalculations

#### Code Style

```swift
@GraphStored var count: Int = 0

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

#### Storage Abstraction

Native persistence via Storage protocol:

```swift
@GraphStored(backed: .userDefaults(key: "theme")) var theme: Theme = .light
```

#### Thread Safety

Per-node `OSAllocatedUnfairLock` for atomic operations with `@MainActor` isolation preservation.

#### Strengths

- Jotai-equivalent auto-tracking natively in Swift
- Declarative syntax via Swift 6.0 macros
- Concurrency-safe by design
- Native persistence support

---

### Android — Push Mainstream, Graph Emerging in UI Layer

#### ViewModel + StateFlow (Push, Manual Wiring)

The industry standard on Android. Push-based with manual `combine` wiring for derived state.

```kotlin
val isLoading: StateFlow<Boolean>
val user: StateFlow<User?>
val posts: StateFlow<List<Post>>

val uiState = combine(isLoading, user, posts) { loading, user, posts ->
    UiState(loading, user, posts)
}
```

#### Jetpack Compose `derivedStateOf` (Pull + Graph in UI Layer)

Compose achieves pull-based graph tracking **within the UI layer**:

```kotlin
val list = remember { mutableStateListOf<Item>() }
val count by remember {
    derivedStateOf { list.count { it.done } }
}
```

- Auto-tracks State reads via the Snapshot system
- Derived states reading other derived states form a DAG
- Conditional invalidation: suppresses recomposition if the result hasn't changed

This is **UI-layer only** — not available in the business logic layer.

#### ReactiveState-Kotlin (Pull + Graph for Business Logic)

```kotlin
val base = MutableStateFlow(0)
val extra = MutableStateFlow(0)
val sum: StateFlow<Int> = derived { get(base) + get(extra) }
```

Kotlin Multiplatform compatible, but not yet mainstream.

---

## Comparison Table

| | **Verge** | **TCA** | **Zustand** | **TanStack Store** | **Jotai** | **swift-state-graph** | **Compose derivedStateOf** |
|---|---|---|---|---|---|---|---|
| Paradigm | Push | Push | Push | Push | Pull | Pull | Pull (UI layer) |
| Graph | Derived pipeline | None | None | Explicit deps | Implicit auto | Implicit auto | Implicit auto |
| Primitive | Store + Commit | Store + Reducer | Single Store | Store + Derived + Effect | Atom | Stored + Computed | State + derivedStateOf |
| Derived State | `Derived<T>` pipeline | Computed in reducer / state | Selector | `Derived` class | `atom(get => ...)` | `@GraphComputed` | `derivedStateOf {}` |
| Dep. Tracking | `@Tracking` + ifChanged | Manual | Selector equality | Explicit `deps` array | Auto (`get()`) | Auto (ThreadLocal) | Auto (Snapshot) |
| Evaluation | Eager (push on change) | Eager (push on action) | Eager (notify all) | Lazy (on access) | On-demand | Lazy invalidation | Conditional invalidation |
| Composition | Store scoping | Reducer composition | Middleware | Framework adapters | Atom composition | Node graph | Compose tree |
| Thread Safety | swift-atomics | MainActor | — (JS) | — (JS) | — (JS) | Per-node lock | Snapshot system |
| Language | Swift | Swift | TypeScript | TypeScript | TypeScript | Swift 6.0 | Kotlin |
| Framework | SwiftUI/UIKit | SwiftUI | React | Multi-framework | React | SwiftUI/UIKit | Jetpack Compose |

---

## Code Style Comparison

The same operation — **deriving `doubled` from `count`** — across all libraries.

### Push-based Libraries

**Verge**
```swift
struct MyState: Equatable {
  var count: Int = 0
}
let store = Store<MyState, Never>(initialState: .init())
store.commit { $0.count += 1 }

// Derived state via pipeline
let doubled = store.derived(.map(\.count).map { $0 * 2 })
```

**TCA**
```swift
@Reducer
struct Counter {
  struct State: Equatable {
    var count = 0
    var doubled: Int { count * 2 }  // Computed property on State
  }
  enum Action { case increment }
  var body: some ReducerOf<Self> {
    Reduce { state, action in
      switch action {
      case .increment:
        state.count += 1
        return .none
      }
    }
  }
}
```

**Zustand**
```typescript
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))
const doubled = useStore((state) => state.count * 2)
```

**TanStack Store**
```typescript
const countStore = new Store(0)
const doubled = new Derived({
  deps: [countStore],
  fn: () => countStore.state * 2,
})
```

### Pull-based Libraries

**Jotai**
```javascript
const countAtom = atom(0)
const doubledAtom = atom((get) => get(countAtom) * 2)
```

**swift-state-graph**
```swift
@GraphStored var count: Int = 0

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

**Jetpack Compose**
```kotlin
var count by remember { mutableIntStateOf(0) }
val doubled by remember {
  derivedStateOf { count * 2 }
}
```

**StateFlow combine (Manual Wiring)**
```kotlin
val count = MutableStateFlow(0)
val doubled = count.map { it * 2 }
```

---

## Relationship with Signals

**Signals** — gaining adoption in Angular (v16+), SolidJS, Vue 3 (ref/computed), and the TC39 standardization proposal — are fundamentally a **pull-based, graph-tracked** approach:

- **Fine-grained change detection**: changes propagate only to the affected scope
- **Lazy evaluation**: recalculation happens only when the value is read
- **Automatic dependency tracking**: reading a value registers the dependency

Jotai and swift-state-graph share this lineage. TanStack Store shares the fine-grained update goal but uses explicit rather than implicit tracking. Push-based libraries like Verge and TCA take a different path entirely — they optimize within the push model using techniques like `@Tracking` and reducer composition.

---

## Why Both Approaches Coexist

### Push excels at...

- **Predictability**: All state changes flow through explicit paths (actions, commits)
- **Debugging**: Easy to trace what changed and why (action logs, middleware)
- **Structure**: Enforces architectural patterns (unidirectional flow, reducer composition)
- **Familiarity**: The dominant model in most ecosystems (Redux, MVI, MVVM)

### Pull excels at...

- **Fine-grained updates**: Only the exact consumers of changed state are invalidated
- **Reduced boilerplate**: No manual wiring of dependencies
- **Dynamic dependencies**: Dependencies can change based on runtime conditions
- **Scalability of derived state**: Adding a new derived value doesn't require modifying existing wiring

### The real question isn't "which is better"

Both push and pull architectures need derived state. The question is whether the **dependency tracking for that derived state** should be:

1. **Manual** — the developer wires it (StateFlow `combine`, Zustand selectors)
2. **Declarative** — the developer declares it (TanStack Store `deps`, Verge `Derived`)
3. **Automatic** — the runtime discovers it (Jotai `get()`, swift-state-graph ThreadLocal, Compose Snapshot)

Graph-based tracking (options 2 and 3) reduces the manual wiring cost. It can be applied within a push architecture (Verge, TanStack Store) or as the foundation of a pull architecture (Jotai, swift-state-graph).

---

## Cross-platform Summary

| Platform | Push-based (Mainstream) | Pull-based / Graph (Emerging) |
|---|---|---|
| **Web** | Redux, Zustand | Jotai, Signals (SolidJS, Angular, Vue), TanStack Store (push+graph) |
| **iOS** | Verge, TCA | swift-state-graph |
| **Android** | ViewModel + StateFlow | Compose `derivedStateOf` (UI layer only) |

The trend is not a wholesale shift from push to pull. Rather, **graph-based dependency tracking for derived state** is being adopted across paradigms — sometimes within push systems (Verge's `Derived`, TanStack Store), sometimes as the core of pull systems (Jotai, swift-state-graph), and sometimes within the UI framework itself (Compose, Signals).

---

## Conclusion

State management architecture should be understood along two independent axes:

**Push vs Pull** determines how state changes flow to consumers. Push is explicit and structured; pull is fine-grained and lazy. Both are valid, and the choice depends on the application's needs and the team's priorities.

**Graph-based dependency tracking** is a technique — not a paradigm. It addresses the universal need for derived state by managing dependencies as a DAG, reducing manual wiring. This technique is appearing across both push and pull systems, across Web, iOS, and Android.

The real evolution is not "push to pull" but rather: **derived state dependency management is becoming increasingly automated**, regardless of whether the underlying architecture pushes or pulls.

---

## References

- [Verge](https://github.com/VergeGroup/swift-verge) — VergeGroup
- [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture) — Point-Free
- [Zustand](https://github.com/pmndrs/zustand) — pmndrs
- [Jotai](https://github.com/pmndrs/jotai) — pmndrs
- [TanStack Store](https://github.com/TanStack/store) — TanStack
- [swift-state-graph](https://github.com/VergeGroup/swift-state-graph) — VergeGroup
- [Jetpack Compose State](https://developer.android.com/develop/ui/compose/state) — Android Developers
- [ReactiveState-Kotlin](https://github.com/ensody/ReactiveState-Kotlin) — ensody
- [Jotai Core Internals](https://jotai.org/docs/guides/core-internals)
- [How derivedStateOf works](https://blog.zachklipp.com/how-derivedstateof-works-a-deep-d-er-ive/) — Zach Klipp
