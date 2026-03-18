# State of State Management — Graph-based の潮流

> フロントエンド・モバイル開発における状態管理アーキテクチャの比較と展望（2026年3月）

---

## はじめに

フロントエンド・モバイル開発において、「どのように状態の依存関係を管理するか」というテーマが再び注目を集めている。従来の ViewModel や単純な Store に代表される **Push 型** の状態管理に対し、依存関係を有向非巡回グラフ（DAG）として自動管理する **Graph-based（グラフ型）** という思想が、プラットフォームを横断して広がりつつある。

このレポートでは、Web・iOS・Android の主要ライブラリを横断し、その設計思想・内部アーキテクチャ・コードスタイルを比較する。

---

## Push 型 vs Graph 型

### Push 型（従来の主流）

状態が変化したら、すべての購読者に通知する。開発者が「どの状態がどの状態に依存するか」を手動で配線する必要がある。

- StateFlow の `combine`、RxJS の `combineLatest` が典型
- アプリが複雑になるほど配線の数が増え、依存関係の追跡が困難になる
- 代表: ViewModel + StateFlow（Android）、Redux（Web）

### Graph 型（台頭中）

状態ノード同士の依存関係をランタイム（またはコンパイル時）が自動的に管理する。状態を「読む」という行為そのものが依存の登録になり、変更は影響する範囲だけに最小限に伝播する。

- 依存グラフが自動構築される
- 変更の影響範囲だけが再計算される（fine-grained updates）
- 代表: Jotai（Web）、swift-state-graph（iOS）

---

## 依存追跡の3つのスタイル

Graph-based と一口に言っても、依存の追跡方法には明確な違いがある。

### 1. 自動・暗黙的追跡

状態ノードを「読む」という行為がそのまま依存の登録になる。開発者は依存関係を意識する必要がない。

- **Jotai**: `atom(get => get(otherAtom))` — `get()` 呼び出し時に自動追跡
- **swift-state-graph**: ThreadLocal を使ってアクセスを観察し、依存を自動発見
- **Jetpack Compose**: `derivedStateOf {}` ブロック内の State 読み取りを Snapshot システムが追跡

### 2. 明示的追跡

依存するノードを `deps` 配列などで開発者が宣言する。自動追跡による暗黙性を避け、依存関係を見える形で管理する。

- **TanStack Store**: `new Derived({ deps: [storeA, storeB], fn: ... })`

### 3. 追跡なし（購読型）

依存関係のグラフを持たず、セレクタで「どの変化を気にするか」を開発者が個別に指定する。

- **Zustand**: `useStore(state => state.count)` — セレクタの返り値を `Object.is` で比較

---

## 各ライブラリの詳細

---

### Zustand — シンプルな購読型の代表

- **リポジトリ**: https://github.com/pmndrs/zustand
- **言語**: TypeScript
- **対応FW**: React（Vanilla Core はフレームワーク非依存）

#### アーキテクチャ

2層構造で設計されている。

1. **Vanilla Core 層** (`vanilla.ts`): フレームワーク非依存の状態管理。内部は `Set<Listener>` による単純な購読パターン
2. **React 統合層** (`react.ts`): `useSyncExternalStore` を活用した React フック

#### 依存追跡

**依存追跡を行わない**。これは意図的な設計判断だ。状態が変化するとすべてのリスナーに通知し、各リスナーがセレクタの返り値を `Object.is` で比較して再レンダリングの要否を判断する。

#### Derived State

Store 内に専用の仕組みはない。コンポーネント側のセレクタ関数内で派生値を計算する。

```typescript
// Store 定義 — 単一オブジェクト
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}))

// セレクタで派生値を計算（Store 側にグラフはない）
const doubled = useStore((state) => state.bears * 2)
```

#### 強み

- バンドルサイズ約 2KB と極めて軽量
- 学習コストが低く、実装がシンプルで予測しやすい
- Provider 不要（Store はシングルトン）
- ミドルウェアによる拡張（persist, devtools, immer 等）

#### 限界

- 状態が複雑に依存し合う場合、セレクタの手動管理が負担になる
- 「どの状態がどれに影響するか」はコード上で追跡しにくい

---

### Jotai — 自動追跡のAtomグラフ

- **リポジトリ**: https://github.com/pmndrs/jotai
- **言語**: TypeScript
- **対応FW**: React

#### アーキテクチャ

Atom（原子）を最小単位とする **Bottom-up** の設計。小さな Atom を合成して依存グラフを構築する。

#### 依存追跡

`atom(get => get(otherAtom))` の `get()` 呼び出し時にランタイムが依存を自動追跡する。依存グラフは毎回の read 関数実行時にリフレッシュされるため、条件分岐による動的な依存関係にも対応する。

#### 依存グラフの管理

- Atom A に Atom B が依存する場合、A は B の **dependency**、B は A の **dependent**
- 初回使用時に read 関数が実行され、依存関係が結論づけられる
- dependent は dependency の dependents セットに追加される

#### Derived State

derived atom は他の atom の値に依存する atom として定義される。write 関数を指定すれば書き込み可能な derived atom にもなる。

```javascript
// 基本 atom
const countAtom = atom(0)

// derived atom — get() が依存を自動登録
const doubledAtom = atom((get) => get(countAtom) * 2)

// 書き込み可能な derived atom
const decrementAtom = atom(
  (get) => get(countAtom),
  (get, set) => set(countAtom, get(countAtom) - 1)
)
```

#### Recoil との関係

Meta が開発した Recoil（2020年）と同じ Atom ベースの思想を持つが、Jotai はよりシンプルな API で同等の機能を実現する。Recoil は現在メンテナンスが停滞しており、Jotai がこの領域の事実上の標準になりつつある。

#### 強み

- 依存関係の手動配線が不要
- React Context の余分な再レンダリング問題を解決
- Signals に近い開発体験を宣言的プログラミングモデルで実現

---

### TanStack Store — 明示的なグラフ型

- **リポジトリ**: https://github.com/TanStack/store
- **言語**: TypeScript
- **対応FW**: React, Vue, Solid, Angular, Svelte

#### アーキテクチャ

3つの基本プリミティブで構成される。

1. **Store**: 変更可能な状態コンテナ。`setState()` による immutable な更新
2. **Derived**: 遅延評価される計算値。依存が変わると自動再計算
3. **Effect**: 自動的な依存追跡とクリーンアップを持つ副作用管理

#### 依存追跡

**双方向の依存関係マップ**を内部に持つ。

- `__storeToDerived`: Store → Derived への依存関係マップ
- `__derivedToStore`: Derived → Store への逆参照マップ

ただし、依存の登録自体は `deps` 配列による**明示的な宣言**が必要。Jotai のような暗黙的自動追跡ではない。

#### Derived State

```typescript
const countStore = new Store(0)

const doubled = new Derived({
  deps: [countStore],       // ← 依存を明示的に宣言
  fn: () => countStore.state * 2,
})
```

計算関数は `prevVal`、`prevDepVals`、`currDepVals` にアクセス可能で、状態変化の履歴を追跡できる。

#### バッチ更新

`batch()` 関数により複数の更新を集約し、不要な中間レンダリングを防ぐ。内部の `__flush()` メカニズムが依存グラフを走査して効率的に更新を伝播する。

#### 強み

- 依存関係が `deps` 配列で一目瞭然
- フレームワーク非依存（TanStack エコシステム全体の基盤）
- Effect が専用クラスとして分離されている

---

### swift-state-graph — iOS 向けの Jotai

- **リポジトリ**: https://github.com/VergeGroup/swift-state-graph
- **言語**: Swift 6.0+
- **対応FW**: SwiftUI, UIKit
- **要件**: iOS 17+

#### アーキテクチャ

DAG ベースの反応型状態管理。ノードは状態コンテナを表し、エッジは依存関係を表現する。Jotai、Recoil の設計思想を Swift に移植した実装。

#### ノードの2つの型

1. **Stored\<Value\>** (`@GraphStored`): 変更可能な状態ノード（ソースノード）
2. **Computed\<Value\>** (`@GraphComputed`): 読み取り専用の派生状態ノード

#### 依存追跡

**ランタイム時の自動依存関係発見**を行う。

1. `withGraphTracking` 確立時に `ThreadLocal<TrackingContext>` を設定
2. ノードの `wrappedValue` アクセス時にコンテキストを確認
3. エッジを自動記録（source → consumer）
4. 計算クロージャ内のアクセスで依存関係を動的に特定

これは Jotai の `get()` による自動追跡と同じ思想だが、Swift の ThreadLocal を使っている点が異なる。

#### 変更伝播

**遅延無効化パターン**を採用している。

1. `Stored` の値が変更されると、直後の依存ノードを即座に dirty マーク
2. 計算ノードは実行されず、単に無効フラグが設定される
3. `wrappedValue` アクセス時のみ再計算（遅延評価）
4. 複数の連続変更でも不要な再計算を回避

#### マクロによるコード生成

Swift 6.0 のマクロ機能を活用し、ボイラープレートを最小化している。

```swift
@GraphStored var count: Int = 0
// ↑ マクロが隠し $backing ストレージと get/set アクセサを自動展開

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

#### ストレージ抽象化

Jotai/Recoil にはない特徴として、**Storage protocol** による永続化をネイティブサポートする。

- `InMemoryStorage`（デフォルト）
- `UserDefaultsStorage`（自動永続化）
- カスタム実装可能

```swift
@GraphStored(backed: .userDefaults(key: "theme")) var theme: Theme = .light
```

#### スレッド安全性

`OSAllocatedUnfairLock` をノード単位で保有し、原子的操作を確保する。`@MainActor` 分離を保持しながら、tracking callbacks 内での actor isolation を維持する。JavaScript の単一スレッドモデルでは不要だが、Swift Concurrency 環境では不可欠な設計だ。

#### 強み

- Jotai と同等の自動依存追跡を Swift ネイティブで実現
- マクロによる宣言的な記法
- ノード単位のロックによる並行安全性
- 永続化がネイティブサポート

---

### Android — Push 型と Graph 型の混在

#### 主流: ViewModel + StateFlow（Push 型）

Android では Google が公式で推進してきた ViewModel + StateFlow + Jetpack Compose という構成が業界標準として定着している。

```kotlin
// Push 型の典型的なパターン
val isLoading: StateFlow<Boolean>
val user: StateFlow<User?>
val posts: StateFlow<List<Post>>

// 複数の状態を組み合わせるたびに combine が必要（手動配線）
val uiState = combine(isLoading, user, posts) { loading, user, posts ->
    UiState(loading, user, posts)
}

// さらに派生状態が増えると配線が膨らんでいく
val filteredPosts = combine(posts, searchQuery) { posts, query -> ... }
val badge = combine(filteredPosts, user) { ... }
```

#### Jetpack Compose の `derivedStateOf`（UI 層の Graph 型）

Compose 自体が UI 層でグラフ型の依存追跡を実現している。

```kotlin
val list = remember { mutableStateListOf<Item>() }
val count by remember {
    derivedStateOf { list.count { it.done } }
    // ↑ ブロック内の State 読み取りが自動的に依存グラフを構築
}
```

内部では Snapshot システムを使い、以下の仕組みで動作する。

- `derivedStateOf {}` ブロック内での State オブジェクト読み取りを自動追跡
- derived state が別の derived state を読むことでDAGを形成
- 依存の書き込みが発生しても、計算結果が変わらなければ再コンポジションを抑制（conditional invalidation）
- `DerivedStateObserver` インターフェースによるネストした依存ツリーの管理

ただし、これはあくまで **UI 層（Compose）専用**であり、ビジネスロジック層には適用されない。

#### ReactiveState-Kotlin（ビジネスロジック層の Graph 型）

```kotlin
val base = MutableStateFlow(0)
val extra = MutableStateFlow(0)

// get() 呼び出しで依存を自動追跡 — Jotai の atom(get => ...) と同思想
val sum: StateFlow<Int> = derived { get(base) + get(extra) }

autoRun {
    if (get(sum) > 10) alert("too high")  // sum の変更を自動で購読
}
```

Kotlin Multiplatform 対応で Android/iOS 共通で使えるが、まだメジャーな選択肢とは言えない。

#### なぜ Android で Graph 型専用ライブラリが普及しないか

1. **Google の公式推進**: LiveData → StateFlow という Push 型のエコシステムが強固
2. **MVI/MVVM の定着**: 「ViewModel が単一の状態を emit する」アーキテクチャが業界標準
3. **Kotlin Coroutines/Flow**: 強力な Push 型ツールが言語レベルで存在
4. **Compose が部分的に解決**: UI 層の細粒度 reactivity は `derivedStateOf` で対応済み

---

## 比較表

| | **Zustand** | **Jotai** | **TanStack Store** | **swift-state-graph** | **Compose derivedStateOf** |
|---|---|---|---|---|---|
| 流派 | 購読型 | グラフ型 | グラフ型 | グラフ型 | グラフ型（UI層） |
| 依存追跡 | なし（セレクタ） | 自動・暗黙的 | 明示的（deps宣言） | 自動・暗黙的 | 自動・暗黙的 |
| 基本単位 | 単一 Store | Atom（分散） | Store + Derived + Effect | Stored + Computed | State + derivedStateOf |
| 設計方向 | Top-down | Bottom-up | Top-down | Bottom-up | Top-down |
| 評価戦略 | 即時通知 | オンデマンド | 遅延評価 | 遅延無効化 | 条件付き無効化 |
| 副作用 | ミドルウェア | 外部ライブラリ | Effect クラス | withGraphTracking | LaunchedEffect |
| 永続化 | persist ミドルウェア | プラグイン | プラグイン | ネイティブ（Storage protocol） | — |
| スレッド安全 | — (JS) | — (JS) | — (JS) | per-node ロック | Snapshot system |
| バンドルサイズ | ~2KB | ~3KB | ~3KB | — | Compose に内蔵 |
| 対応FW | React | React | React/Vue/Solid/Angular/Svelte | SwiftUI/UIKit | Jetpack Compose |
| 言語 | TypeScript | TypeScript | TypeScript | Swift 6.0 | Kotlin |

---

## コードスタイル比較

同じ「count から doubled を派生する」処理を各ライブラリで書いた場合の比較。

### Zustand（購読型・セレクタ）

```typescript
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

// 派生値はコンポーネント側のセレクタで計算
const doubled = useStore((state) => state.count * 2)
```

### Jotai（暗黙的グラフ）

```javascript
const countAtom = atom(0)
const doubledAtom = atom((get) => get(countAtom) * 2)
// get() の呼び出しが依存を自動登録。配線不要。
```

### TanStack Store（明示的グラフ）

```typescript
const countStore = new Store(0)
const doubled = new Derived({
  deps: [countStore],          // ← 依存を明示的に宣言
  fn: () => countStore.state * 2,
})
```

### swift-state-graph（Swiftマクロ + 自動追跡）

```swift
@GraphStored var count: Int = 0

@GraphComputed var doubled: Int
$doubled = .init { [$count] _ in
  $count.wrappedValue * 2
}
```

### Jetpack Compose（UI 層の自動追跡）

```kotlin
var count by remember { mutableIntStateOf(0) }
val doubled by remember {
  derivedStateOf { count * 2 }
  // count の読み取りが自動的に依存を登録
}
```

### StateFlow combine（Android の手動配線）

```kotlin
val count = MutableStateFlow(0)
val doubled = count.map { it * 2 }  // 依存を手動で指定
```

---

## Signals との関係

Web フロントエンドでは **Signals** という概念が急速に普及している。Angular（v16〜）、SolidJS、Vue 3（ref/computed）、そして TC39 での標準化提案と、複数の方向から同時に進んでいる。

Signals と Graph-based State Management は思想的に一致している。

- **細粒度の変更検知**: 状態の変更が影響する範囲だけに伝播する
- **遅延評価**: 依存が変わっても、実際に読まれるまで再計算しない
- **自動依存追跡**: 値を「読む」行為が依存の登録になる

Jotai は「React における Signals 的な開発体験を、宣言的プログラミングモデルの中で実現する」と自ら位置付けている。swift-state-graph も同じ系譜にある。TanStack Store は Signals ほど暗黙的ではないが、fine-grained updates という目標は共有している。

Zustand はこの流れとは距離を置いており、「状態管理に複雑なことはしない」というシンプルさを設計の中心に据え続けている。

---

## なぜ今この思想が広がっているのか

### アプリケーションの複雑化

状態の数が増え、互いに依存し合う関係が増えるほど、手動の配線コスト（`combine`、`combineLatest` 等）が積み重なっていく。Graph-based はこの問題を「依存の自動追跡」で根本的に解決しようとするアプローチだ。

### パフォーマンスへの要求

細粒度の更新が自動的に行われることで、不要な再レンダリングや再計算を回避できる。React の Context API が持つ「Provider 配下の全コンポーネントが再レンダリングされる」問題に対する解の一つでもある。

### 宣言的UIとの親和性

SwiftUI、Jetpack Compose、React はいずれも宣言的 UI フレームワークだ。「状態が変わったら UI が自動的に更新される」という前提の上で、状態間の依存関係も自動的に追跡されるのは自然な拡張といえる。

### プラットフォーム横断の収束

Web（Jotai、Signals）、iOS（swift-state-graph）、Android（Compose derivedStateOf）と、異なるプラットフォームが独立して同じ方向に向かっている。これは単一のライブラリの流行ではなく、状態管理というドメイン全体のパラダイムシフトと捉えるべきだろう。

---

## まとめ

状態管理の設計は、大きく **購読型** と **グラフ型** に分かれる。

**購読型**（Zustand）はシンプルさと予測可能性を武器に広く使われ続ける。小〜中規模のアプリケーションではこの方式で十分であり、学習コストの低さは大きな強みだ。

**グラフ型**（Jotai、TanStack Store、swift-state-graph）は、状態の複雑さに比例してメリットが増す。依存関係の自動追跡により配線コストを削減し、fine-grained な更新で不要な再計算を防ぐ。Web では Jotai が、iOS では swift-state-graph がこのアプローチを実現しており、Android では Compose の `derivedStateOf` という形で部分的に採用されている。

「依存を自動追跡し、最小限の再計算で状態を伝播する」という思想は、プラットフォームを問わず今後の状態管理の共通方向性になりつつある。

---

## 参考

- [Zustand](https://github.com/pmndrs/zustand) — pmndrs
- [Jotai](https://github.com/pmndrs/jotai) — pmndrs
- [TanStack Store](https://github.com/TanStack/store) — TanStack
- [swift-state-graph](https://github.com/VergeGroup/swift-state-graph) — VergeGroup
- [Jetpack Compose State](https://developer.android.com/develop/ui/compose/state) — Android Developers
- [ReactiveState-Kotlin](https://github.com/ensody/ReactiveState-Kotlin) — ensody
- [Jotai Core Internals](https://jotai.org/docs/guides/core-internals)
- [How derivedStateOf works](https://blog.zachklipp.com/how-derivedstateof-works-a-deep-d-er-ive/) — Zach Klipp
