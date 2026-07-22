# Graph Report - D:\GitHub\Vocal Muse  (2026-07-22)

## Corpus Check
- 132 files · ~69,299 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 992 nodes · 1947 edges · 54 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 70 edges
2. `cacheSet()` - 20 edges
3. `hashInputs()` - 18 edges
4. `runLocalPipeline()` - 18 edges
5. `compilerOptions` - 17 edges
6. `Button` - 16 edges
7. `loadStyleMemory()` - 16 edges
8. `fetch()` - 15 edges
9. `endRhymeKey()` - 14 edges
10. `Badge()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `transcribeAudio()` --calls--> `fetch()`  [INFERRED]
  src/lib/ai-gateway.server.ts → src/server.ts
- `AlertDialogHeader()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert-dialog.tsx → src/lib/utils.ts
- `AlertDialogFooter()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert-dialog.tsx → src/lib/utils.ts
- `BreadcrumbSeparator()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts
- `BreadcrumbEllipsis()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (54 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (53): SettingsPage(), TRAINING_SEEDS, ImportMergeDialog(), Strategy, harvestFromUrl, Input, addBurnedPhrasesFromBars(), addHarvestedBars() (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (61): dependencies, ai, @ai-sdk/openai-compatible, class-variance-authority, clsx, cmdk, date-fns, embla-carousel-react (+53 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (48): BackendCard(), RecommendedInstall(), RecommendedWhisperInstall(), CachePanel(), LABELS, Status, CacheNamespace, formatBytes() (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (38): Route, Route, Route, Route, Route, Route, LocalStatusPill(), LovableErrorOptions (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (37): useIsMobile(), Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+29 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (38): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, fake-indexeddb (+30 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (35): ConnectPage(), briefBlock(), buildCadence(), ChatOpts, criticPass(), fillToCadence(), formatRepair(), group() (+27 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (27): BarLocalState, BarProposal, BarSlice, BarVersion, bulkKey(), BulkOpts, BulkPersist, DEFAULT_BULK_OPTS (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (23): getAdmin(), lovable, lovableAuth, SignInOptions, errorMiddleware, attachSupabaseAuth, requireSupabaseAuth, createSupabaseClient() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (27): barsForTrack(), base64ToBlob(), blobToBase64(), Bundle, deleteBlob(), deleteTrack(), downloadBundle(), estimateStorage() (+19 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (22): ReferencesPage(), BarDiff(), diffWords(), tokenize(), briefBlock(), buildFingerprint(), Fingerprint, fingerprintToConstraints() (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (23): BarRewriteInput, buildCadenceMap(), CadenceMapSchema, CreateTrackInput, deleteTrack, DeviceId, EditorResultSchema, getTrack (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (16): BarRow, ATTITUDES, GENRES, REGIONS, StyleBriefForm(), DEFAULT_BRIEF, SelectContent, SelectItem (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (20): heuristicCadence(), splitBars(), CadenceBar, CLICHES, countCliches(), scoreCadenceMatch(), avgRhymeChainSyllables(), classifyScheme() (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (16): RhymeLookup(), CmudictRhymeHit, cmudictLookup(), customLookup(), datamuse(), DatamuseHit, datamuseLookup(), lookupRhymes() (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (17): hashBlob(), hashInputs(), sha256Hex(), chatInBrowser(), getModelId(), getWhisperModelId(), InBrowserEmbedConfig, InBrowserLlmConfig (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.19
Nodes (15): callCloud(), callLocal(), cosineSim(), EmbedBackend, EmbedContext, embeddingsAvailable(), embedMany(), embedOne() (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (16): cn(), Button, ButtonProps, buttonVariants, Calendar(), CalendarDayButton(), Pagination(), PaginationContent (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (17): createLovableGateway(), transcribeAudio(), BarRewriteOptions, BarRewriteSchema, callCriticGemini(), CouncilVerdict, CriticResponseSchema, CriticResult (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.20
Nodes (13): ensureCmudictLoaded(), findRhymes(), findRhymesBySound(), getAllPhonemes(), getLastStressedVowel(), getRhymeEnding(), getVowelPhonemes(), getWordInfo() (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (11): Avatar, AvatarFallback, AvatarImage, HoverCardContent, RadioGroup, RadioGroupItem, ToggleGroup, ToggleGroupContext (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (13): approxBytes(), cacheGet(), CacheRecord, cacheSet(), cacheStats, clearCache(), enforceLimit(), LIMITS (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (11): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (10): encodeWav(), writeString(), LocalBrief, LocalCadence, LocalLyrics, LocalPipelineResult, LocalQuality, ProgressEvent (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.20
Nodes (8): LiveCapture, LiveCaptureOpts, playClick(), State, blobToBase64(), encodeWav(), rms(), writeString()

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (12): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.28
Nodes (13): briefToPromptBlock(), coerceLyrics(), editorPass(), fallbackLyricLines(), fallbackLyrics(), flattenLyricsLines(), groupBarsIntoLyrics(), normalizeLyrics() (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (11): CommitBar, CommitInput, commitLiveTake, DeviceId, GenerateBarInput, generateLiveBar, StyleBriefSchema, transcribeBar (+3 more)

### Community 31 - "Community 31"
Cohesion: 0.25
Nodes (10): CalibrateOpts, calibrateWithRetry(), clearCalibratedLatencyMs(), detectPeaks(), LatencyResult, loadCalibratedLatencyMs(), measureMicLatencyMs(), mergeChunks() (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (7): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, THEMES

### Community 33 - "Community 33"
Cohesion: 0.27
Nodes (6): LibraryPage(), Route, getDeviceId(), isLocalOnly(), listTracks, Skeleton()

### Community 34 - "Community 34"
Cohesion: 0.36
Nodes (6): consumeLastCapturedError(), renderErrorPage(), fetch(), getServerEntry(), normalizeCatastrophicSsrResponse(), ServerEntry

### Community 35 - "Community 35"
Cohesion: 0.20
Nodes (8): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut()

### Community 36 - "Community 36"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.20
Nodes (9): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent (+1 more)

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (8): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 46 - "Community 46"
Cohesion: 0.50
Nodes (3): AccordionContent, AccordionItem, AccordionTrigger

## Knowledge Gaps
- **412 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `css` (+407 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 17` to `Community 0`, `Community 2`, `Community 4`, `Community 7`, `Community 12`, `Community 14`, `Community 22`, `Community 23`, `Community 25`, `Community 28`, `Community 32`, `Community 33`, `Community 35`, `Community 36`, `Community 37`, `Community 38`, `Community 39`, `Community 40`, `Community 41`, `Community 42`, `Community 43`, `Community 44`, `Community 46`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `getAdmin()` connect `Community 8` to `Community 11`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `Button` connect `Community 17` to `Community 0`, `Community 33`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 10`, `Community 12`, `Community 14`, `Community 26`, `Community 28`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _412 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06025039123630673 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03278688524590164 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06428571428571428 - nodes in this community are weakly interconnected._