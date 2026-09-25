// ⚠️  AUTO-GENERATED — do not edit by hand.
// Source: devtools-protocol v1.3
// Regenerate: `bun run scripts/gen-cdp-types.ts`

/* eslint-disable */
/**
 * Accessibility
 * @experimental
 */
export namespace Accessibility {
  /** A node in the accessibility tree. */
  export interface AXNode {
    nodeId: Accessibility.AXNodeId;
    ignored: boolean;
    ignoredReasons?: Accessibility.AXProperty[];
    role?: Accessibility.AXValue;
    chromeRole?: Accessibility.AXValue;
    name?: Accessibility.AXValue;
    description?: Accessibility.AXValue;
    value?: Accessibility.AXValue;
    properties?: Accessibility.AXProperty[];
    parentId?: Accessibility.AXNodeId;
    childIds?: Accessibility.AXNodeId[];
    backendDOMNodeId?: DOM.BackendNodeId;
    frameId?: Page.FrameId;
  }
  /** Unique accessibility node identifier. */
  export type AXNodeId = string;
  export interface AXProperty {
    name: Accessibility.AXPropertyName;
    value: Accessibility.AXValue;
  }
  /**
   * Values of AXProperty name:
   * - from 'busy' to 'roledescription': states which apply to every AX node
   * - from 'live' to 'root': attributes which apply to nodes in live regions
   * - from 'autocomplete' to 'valuetext': attributes which apply to widgets
   * - from 'checked' to 'selected': states which apply to widgets
   * - from 'activedescendant' to 'owns': relationships between elements other than parent/child/sibling
   * - from 'activeFullscreenElement' to 'uninteresting': reasons why this noode is hidden
   */
  export type AXPropertyName = "actions" | "busy" | "disabled" | "editable" | "focusable" | "focused" | "hidden" | "hiddenRoot" | "invalid" | "keyshortcuts" | "settable" | "roledescription" | "live" | "atomic" | "relevant" | "root" | "autocomplete" | "hasPopup" | "level" | "multiselectable" | "orientation" | "multiline" | "readonly" | "required" | "valuemin" | "valuemax" | "valuetext" | "checked" | "expanded" | "modal" | "pressed" | "selected" | "activedescendant" | "controls" | "describedby" | "details" | "errormessage" | "flowto" | "labelledby" | "owns" | "url" | "activeFullscreenElement" | "activeModalDialog" | "activeAriaModalDialog" | "ariaHiddenElement" | "ariaHiddenSubtree" | "emptyAlt" | "emptyText" | "inertElement" | "inertSubtree" | "labelContainer" | "labelFor" | "notRendered" | "notVisible" | "presentationalRole" | "probablyPresentational" | "inactiveCarouselTabContent" | "uninteresting";
  export interface AXRelatedNode {
    backendDOMNodeId: DOM.BackendNodeId;
    idref?: string;
    text?: string;
  }
  /** A single computed AX property. */
  export interface AXValue {
    type: Accessibility.AXValueType;
    value?: unknown;
    relatedNodes?: Accessibility.AXRelatedNode[];
    sources?: Accessibility.AXValueSource[];
  }
  /** Enum of possible native property sources (as a subtype of a particular AXValueSourceType). */
  export type AXValueNativeSourceType = "description" | "figcaption" | "label" | "labelfor" | "labelwrapped" | "legend" | "rubyannotation" | "tablecaption" | "title" | "other";
  /** A single source for a computed AX property. */
  export interface AXValueSource {
    type: Accessibility.AXValueSourceType;
    value?: Accessibility.AXValue;
    attribute?: string;
    attributeValue?: Accessibility.AXValue;
    superseded?: boolean;
    nativeSource?: Accessibility.AXValueNativeSourceType;
    nativeSourceValue?: Accessibility.AXValue;
    invalid?: boolean;
    invalidReason?: string;
  }
  /** Enum of possible property sources. */
  export type AXValueSourceType = "attribute" | "implicit" | "style" | "contents" | "placeholder" | "relatedElement";
  /** Enum of possible property types. */
  export type AXValueType = "boolean" | "tristate" | "booleanOrUndefined" | "idref" | "idrefList" | "integer" | "node" | "nodeList" | "number" | "string" | "computedString" | "token" | "tokenList" | "domRelation" | "role" | "internalRole" | "valueUndefined";
  /** Disables the accessibility domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables the accessibility domain which causes `AXNodeId`s to remain consistent between method calls.
   * This turns on accessibility for the page, which can impact performance until accessibility is disabled.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Fetches a node and all ancestors up to and including the root.
   * Requires `enable()` to have been called previously.
   * @experimental
   */
  export interface GetAXNodeAndAncestorsRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface GetAXNodeAndAncestorsResponse {
    nodes: Accessibility.AXNode[];
  }
  /**
   * Fetches a particular accessibility node by AXNodeId.
   * Requires `enable()` to have been called previously.
   * @experimental
   */
  export interface GetChildAXNodesRequest {
    id: Accessibility.AXNodeId;
    frameId?: Page.FrameId;
  }
  export interface GetChildAXNodesResponse {
    nodes: Accessibility.AXNode[];
  }
  /**
   * Fetches the entire accessibility tree for the root Document
   * @experimental
   */
  export interface GetFullAXTreeRequest {
    depth?: number;
    frameId?: Page.FrameId;
  }
  export interface GetFullAXTreeResponse {
    nodes: Accessibility.AXNode[];
  }
  /**
   * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
   * @experimental
   */
  export interface GetPartialAXTreeRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    fetchRelatives?: boolean;
  }
  export interface GetPartialAXTreeResponse {
    nodes: Accessibility.AXNode[];
  }
  /**
   * Fetches the root node.
   * Requires `enable()` to have been called previously.
   * @experimental
   */
  export interface GetRootAXNodeRequest {
    frameId?: Page.FrameId;
  }
  export interface GetRootAXNodeResponse {
    node: Accessibility.AXNode;
  }
  /**
   * Query a DOM node's accessibility subtree for accessible name and role.
   * This command computes the name and role for all nodes in the subtree, including those that are
   * ignored for accessibility, and returns those that match the specified name and role. If no DOM
   * node is specified, or the DOM node does not exist, the command returns an error. If neither
   * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
   * @experimental
   */
  export interface QueryAXTreeRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    accessibleName?: string;
    role?: string;
  }
  export interface QueryAXTreeResponse {
    nodes: Accessibility.AXNode[];
  }
  /**
   * The loadComplete event mirrors the load complete event sent by the browser to assistive
   * technology when the web page has finished loading.
   * @experimental
   */
  export interface LoadCompleteEvent {
    root: Accessibility.AXNode;
  }
  /**
   * The nodesUpdated event is sent every time a previously requested node has changed the in tree.
   * @experimental
   */
  export interface NodesUpdatedEvent {
    nodes: Accessibility.AXNode[];
  }
}

/**
 * Animation
 * @experimental
 */
export namespace Animation {
  /** Animation instance. */
  export interface Animation {
    id: string;
    name: string;
    pausedState: boolean;
    playState: string;
    playbackRate: number;
    startTime: number;
    currentTime: number;
    type: "CSSTransition" | "CSSAnimation" | "WebAnimation";
    source?: Animation.AnimationEffect;
    cssId?: string;
    viewOrScrollTimeline?: Animation.ViewOrScrollTimeline;
  }
  /** AnimationEffect instance */
  export interface AnimationEffect {
    delay: number;
    endDelay: number;
    iterationStart: number;
    iterations?: number;
    duration: number;
    direction: string;
    fill: string;
    backendNodeId?: DOM.BackendNodeId;
    keyframesRule?: Animation.KeyframesRule;
    easing: string;
  }
  /** Keyframes Rule */
  export interface KeyframesRule {
    name?: string;
    keyframes: Animation.KeyframeStyle[];
  }
  /** Keyframe Style */
  export interface KeyframeStyle {
    offset: string;
    easing: string;
  }
  /** Timeline instance */
  export interface ViewOrScrollTimeline {
    sourceNodeId?: DOM.BackendNodeId;
    startOffset?: number;
    endOffset?: number;
    subjectNodeId?: DOM.BackendNodeId;
    axis: DOM.ScrollOrientation;
  }
  /** Disables animation domain notifications. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables animation domain notifications. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Returns the current time of the an animation. */
  export interface GetCurrentTimeRequest {
    id: string;
  }
  export interface GetCurrentTimeResponse {
    currentTime: number;
  }
  /** Gets the playback rate of the document timeline. */
  export interface GetPlaybackRateRequest {}
  export interface GetPlaybackRateResponse {
    playbackRate: number;
  }
  /** Releases a set of animations to no longer be manipulated. */
  export interface ReleaseAnimationsRequest {
    animations: string[];
  }
  export interface ReleaseAnimationsResponse {}
  /** Gets the remote object of the Animation. */
  export interface ResolveAnimationRequest {
    animationId: string;
  }
  export interface ResolveAnimationResponse {
    remoteObject: Runtime.RemoteObject;
  }
  /** Seek a set of animations to a particular time within each animation. */
  export interface SeekAnimationsRequest {
    animations: string[];
    currentTime: number;
  }
  export interface SeekAnimationsResponse {}
  /** Sets the paused state of a set of animations. */
  export interface SetPausedRequest {
    animations: string[];
    paused: boolean;
  }
  export interface SetPausedResponse {}
  /** Sets the playback rate of the document timeline. */
  export interface SetPlaybackRateRequest {
    playbackRate: number;
  }
  export interface SetPlaybackRateResponse {}
  /** Sets the timing of an animation node. */
  export interface SetTimingRequest {
    animationId: string;
    duration: number;
    delay: number;
  }
  export interface SetTimingResponse {}
  /** Event for when an animation has been cancelled. */
  export interface AnimationCanceledEvent {
    id: string;
  }
  /** Event for each animation that has been created. */
  export interface AnimationCreatedEvent {
    id: string;
  }
  /** Event for animation that has been started. */
  export interface AnimationStartedEvent {
    animation: Animation.Animation;
  }
  /** Event for animation that has been updated. */
  export interface AnimationUpdatedEvent {
    animation: Animation.Animation;
  }
}

/**
 * Audits domain allows investigation of page violations and possible improvements.
 * @experimental
 */
export namespace Audits {
  /** Information about a cookie that is affected by an inspector issue. */
  export interface AffectedCookie {
    name: string;
    path: string;
    domain: string;
  }
  /** Information about the frame affected by an inspector issue. */
  export interface AffectedFrame {
    frameId: Page.FrameId;
  }
  /** Information about a request that is affected by an inspector issue. */
  export interface AffectedRequest {
    requestId?: Network.RequestId;
    url: string;
  }
  /**
   * Details for issues around "Attribution Reporting API" usage.
   * Explainer: https://github.com/WICG/attribution-reporting-api
   */
  export interface AttributionReportingIssueDetails {
    violationType: Audits.AttributionReportingIssueType;
    request?: Audits.AffectedRequest;
    violatingNodeId?: DOM.BackendNodeId;
    invalidParameter?: string;
  }
  export type AttributionReportingIssueType = "PermissionPolicyDisabled" | "UntrustworthyReportingOrigin" | "InsecureContext" | "InvalidHeader" | "InvalidRegisterTriggerHeader" | "SourceAndTriggerHeaders" | "SourceIgnored" | "TriggerIgnored" | "OsSourceIgnored" | "OsTriggerIgnored" | "InvalidRegisterOsSourceHeader" | "InvalidRegisterOsTriggerHeader" | "WebAndOsHeaders" | "NoWebOrOsSupport" | "NavigationRegistrationWithoutTransientUserActivation" | "InvalidInfoHeader" | "NoRegisterSourceHeader" | "NoRegisterTriggerHeader" | "NoRegisterOsSourceHeader" | "NoRegisterOsTriggerHeader" | "NavigationRegistrationUniqueScopeAlreadySet";
  /**
   * Details for a request that has been blocked with the BLOCKED_BY_RESPONSE
   * code. Currently only used for COEP/COOP, but may be extended to include
   * some CSP errors in the future.
   */
  export interface BlockedByResponseIssueDetails {
    request: Audits.AffectedRequest;
    parentFrame?: Audits.AffectedFrame;
    blockedFrame?: Audits.AffectedFrame;
    reason: Audits.BlockedByResponseReason;
  }
  /**
   * Enum indicating the reason a response has been blocked. These reasons are
   * refinements of the net error BLOCKED_BY_RESPONSE.
   */
  export type BlockedByResponseReason = "CoepFrameResourceNeedsCoepHeader" | "CoopSandboxedIFrameCannotNavigateToCoopPage" | "CorpNotSameOrigin" | "CorpNotSameOriginAfterDefaultedToSameOriginByCoep" | "CorpNotSameOriginAfterDefaultedToSameOriginByDip" | "CorpNotSameOriginAfterDefaultedToSameOriginByCoepAndDip" | "CorpNotSameSite" | "SRIMessageSignatureMismatch";
  /**
   * This issue warns about sites in the redirect chain of a finished navigation
   * that may be flagged as trackers and have their state cleared if they don't
   * receive a user interaction. Note that in this context 'site' means eTLD+1.
   * For example, if the URL `https://example.test:80/bounce` was in the
   * redirect chain, the site reported would be `example.test`.
   */
  export interface BounceTrackingIssueDetails {
    trackingSites: string[];
  }
  /**
   * This issue tracks client hints related issues. It's used to deprecate old
   * features, encourage the use of new ones, and provide general guidance.
   */
  export interface ClientHintIssueDetails {
    sourceCodeLocation: Audits.SourceCodeLocation;
    clientHintIssueReason: Audits.ClientHintIssueReason;
  }
  export type ClientHintIssueReason = "MetaTagAllowListInvalidOrigin" | "MetaTagModifiedHTML";
  export type ConnectionAllowlistError = "InvalidHeader" | "MoreThanOneList" | "ItemNotInnerList" | "InvalidAllowlistItemType" | "ReportingEndpointNotToken" | "InvalidUrlPattern";
  export interface ConnectionAllowlistIssueDetails {
    error: Audits.ConnectionAllowlistError;
    request: Audits.AffectedRequest;
  }
  export interface ContentSecurityPolicyIssueDetails {
    blockedURL?: string;
    violatedDirective: string;
    isReportOnly: boolean;
    contentSecurityPolicyViolationType: Audits.ContentSecurityPolicyViolationType;
    frameAncestor?: Audits.AffectedFrame;
    sourceCodeLocation?: Audits.SourceCodeLocation;
    violatingNodeId?: DOM.BackendNodeId;
  }
  export type ContentSecurityPolicyViolationType = "kInlineViolation" | "kEvalViolation" | "kURLViolation" | "kSRIViolation" | "kTrustedTypesSinkViolation" | "kTrustedTypesPolicyViolation" | "kWasmEvalViolation";
  /**
   * This issue warns about third-party sites that are accessing cookies on the
   * current page, and have been permitted due to having a global metadata grant.
   * Note that in this context 'site' means eTLD+1. For example, if the URL
   * `https://example.test:80/web_page` was accessing cookies, the site reported
   * would be `example.test`.
   */
  export interface CookieDeprecationMetadataIssueDetails {
    allowedSites: string[];
    optOutPercentage: number;
    isOptOutTopLevel: boolean;
    operation: Audits.CookieOperation;
  }
  export type CookieExclusionReason = "ExcludeSameSiteUnspecifiedTreatedAsLax" | "ExcludeSameSiteNoneInsecure" | "ExcludeSameSiteLax" | "ExcludeSameSiteStrict" | "ExcludeDomainNonASCII" | "ExcludeThirdPartyCookieBlockedInFirstPartySet" | "ExcludeThirdPartyPhaseout" | "ExcludePortMismatch" | "ExcludeSchemeMismatch";
  /**
   * This information is currently necessary, as the front-end has a difficult
   * time finding a specific cookie. With this, we can convey specific error
   * information without the cookie.
   */
  export interface CookieIssueDetails {
    cookie?: Audits.AffectedCookie;
    rawCookieLine?: string;
    cookieWarningReasons: Audits.CookieWarningReason[];
    cookieExclusionReasons: Audits.CookieExclusionReason[];
    operation: Audits.CookieOperation;
    siteForCookies?: string;
    cookieUrl?: string;
    request?: Audits.AffectedRequest;
    insight?: Audits.CookieIssueInsight;
  }
  /** Information about the suggested solution to a cookie issue. */
  export interface CookieIssueInsight {
    type: Audits.InsightType;
    tableEntryUrl?: string;
  }
  export type CookieOperation = "SetCookie" | "ReadCookie";
  export type CookieWarningReason = "WarnSameSiteUnspecifiedCrossSiteContext" | "WarnSameSiteNoneInsecure" | "WarnSameSiteUnspecifiedLaxAllowUnsafe" | "WarnSameSiteStrictLaxDowngradeStrict" | "WarnSameSiteStrictCrossDowngradeStrict" | "WarnSameSiteStrictCrossDowngradeLax" | "WarnSameSiteLaxCrossDowngradeStrict" | "WarnSameSiteLaxCrossDowngradeLax" | "WarnAttributeValueExceedsMaxSize" | "WarnDomainNonASCII" | "WarnThirdPartyPhaseout" | "WarnCrossSiteRedirectDowngradeChangesInclusion" | "WarnDeprecationTrialMetadata" | "WarnThirdPartyCookieHeuristic";
  /**
   * Details for a CORS related issue, e.g. a warning or error related to
   * CORS RFC1918 enforcement.
   */
  export interface CorsIssueDetails {
    corsErrorStatus: Network.CorsErrorStatus;
    isWarning: boolean;
    request: Audits.AffectedRequest;
    location?: Audits.SourceCodeLocation;
    initiatorOrigin?: string;
    resourceIPAddressSpace?: Network.IPAddressSpace;
    clientSecurityState?: Network.ClientSecurityState;
  }
  /**
   * This issue tracks information needed to print a deprecation message.
   * https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/frame/third_party/blink/renderer/core/frame/deprecation/README.md
   */
  export interface DeprecationIssueDetails {
    affectedFrame?: Audits.AffectedFrame;
    sourceCodeLocation: Audits.SourceCodeLocation;
    type: string;
  }
  /** This issue warns about errors in the select or summary element content model. */
  export interface ElementAccessibilityIssueDetails {
    nodeId: DOM.BackendNodeId;
    elementAccessibilityIssueReason: Audits.ElementAccessibilityIssueReason;
    hasDisallowedAttributes: boolean;
  }
  export type ElementAccessibilityIssueReason = "DisallowedSelectChild" | "DisallowedOptGroupChild" | "NonPhrasingContentOptionChild" | "InteractiveContentOptionChild" | "InteractiveContentLegendChild" | "InteractiveContentSummaryDescendant";
  export interface FailedRequestInfo {
    url: string;
    failureMessage: string;
    requestId?: Network.RequestId;
  }
  export interface FederatedAuthRequestIssueDetails {
    federatedAuthRequestIssueReason: Audits.FederatedAuthRequestIssueReason;
  }
  /**
   * Represents the failure reason when a federated authentication reason fails.
   * Should be updated alongside RequestIdTokenStatus in
   * third_party/blink/public/mojom/devtools/inspector_issue.mojom to include
   * all cases except for success.
   */
  export type FederatedAuthRequestIssueReason = "ShouldEmbargo" | "TooManyRequests" | "WellKnownHttpNotFound" | "WellKnownNoResponse" | "WellKnownInvalidResponse" | "WellKnownListEmpty" | "WellKnownInvalidContentType" | "ConfigNotInWellKnown" | "WellKnownTooBig" | "ConfigHttpNotFound" | "ConfigNoResponse" | "ConfigInvalidResponse" | "ConfigInvalidContentType" | "IdpNotPotentiallyTrustworthy" | "DisabledInSettings" | "DisabledInFlags" | "ErrorFetchingSignin" | "InvalidSigninResponse" | "AccountsHttpNotFound" | "AccountsNoResponse" | "AccountsInvalidResponse" | "AccountsListEmpty" | "AccountsInvalidContentType" | "IdTokenHttpNotFound" | "IdTokenNoResponse" | "IdTokenInvalidResponse" | "IdTokenIdpErrorResponse" | "IdTokenCrossSiteIdpErrorResponse" | "IdTokenInvalidRequest" | "IdTokenInvalidContentType" | "ErrorIdToken" | "Canceled" | "RpPageNotVisible" | "SilentMediationFailure" | "NotSignedInWithIdp" | "MissingTransientUserActivation" | "ReplacedByActiveMode" | "RelyingPartyOriginIsOpaque" | "TypeNotMatching" | "UiDismissedNoEmbargo" | "CorsError" | "SuppressedBySegmentationPlatform";
  export interface FederatedAuthUserInfoRequestIssueDetails {
    federatedAuthUserInfoRequestIssueReason: Audits.FederatedAuthUserInfoRequestIssueReason;
  }
  /**
   * Represents the failure reason when a getUserInfo() call fails.
   * Should be updated alongside FederatedAuthUserInfoRequestResult in
   * third_party/blink/public/mojom/devtools/inspector_issue.mojom.
   */
  export type FederatedAuthUserInfoRequestIssueReason = "NotSameOrigin" | "NotIframe" | "NotPotentiallyTrustworthy" | "NoApiPermission" | "NotSignedInWithIdp" | "NoAccountSharingPermission" | "InvalidConfigOrWellKnown" | "InvalidAccountsResponse" | "NoReturningUserFromFetchedAccounts";
  /** Depending on the concrete errorType, different properties are set. */
  export interface GenericIssueDetails {
    errorType: Audits.GenericIssueErrorType;
    frameId?: Page.FrameId;
    violatingNodeId?: DOM.BackendNodeId;
    violatingNodeAttribute?: string;
    request?: Audits.AffectedRequest;
  }
  export type GenericIssueErrorType = "FormLabelForNameError" | "FormDuplicateIdForInputError" | "FormInputWithNoLabelError" | "FormAutocompleteAttributeEmptyError" | "FormEmptyIdAndNameAttributesForInputError" | "FormAriaLabelledByToNonExistingIdError" | "FormInputAssignedAutocompleteValueToIdOrNameAttributeError" | "FormLabelHasNeitherForNorNestedInputError" | "FormLabelForMatchesNonExistingIdError" | "FormInputHasWrongButWellIntendedAutocompleteValueError" | "ResponseWasBlockedByORB" | "NavigationEntryMarkedSkippable" | "AutofillAndManualTextPolicyControlledFeaturesInfo" | "AutofillPolicyControlledFeatureInfo" | "ManualTextPolicyControlledFeatureInfo" | "FormModelContextParameterMissingTitleAndDescription" | "FormModelContextMissingToolName" | "FormModelContextMissingToolDescription" | "FormModelContextRequiredParameterMissingName" | "FormModelContextParameterMissingName";
  export interface HeavyAdIssueDetails {
    resolution: Audits.HeavyAdResolutionStatus;
    reason: Audits.HeavyAdReason;
    frame: Audits.AffectedFrame;
  }
  export type HeavyAdReason = "NetworkTotalLimit" | "CpuTotalLimit" | "CpuPeakLimit";
  export type HeavyAdResolutionStatus = "HeavyAdBlocked" | "HeavyAdWarning";
  /** Represents the category of insight that a cookie issue falls under. */
  export type InsightType = "GitHubResource" | "GracePeriod" | "Heuristics";
  /** An inspector issue reported from the back-end. */
  export interface InspectorIssue {
    code: Audits.InspectorIssueCode;
    details: Audits.InspectorIssueDetails;
    issueId?: Audits.IssueId;
  }
  /**
   * A unique identifier for the type of issue. Each type may use one of the
   * optional fields in InspectorIssueDetails to convey more specific
   * information about the kind of issue.
   */
  export type InspectorIssueCode = "CookieIssue" | "MixedContentIssue" | "BlockedByResponseIssue" | "HeavyAdIssue" | "ContentSecurityPolicyIssue" | "SharedArrayBufferIssue" | "CorsIssue" | "AttributionReportingIssue" | "QuirksModeIssue" | "PartitioningBlobURLIssue" | "NavigatorUserAgentIssue" | "GenericIssue" | "DeprecationIssue" | "ClientHintIssue" | "FederatedAuthRequestIssue" | "BounceTrackingIssue" | "CookieDeprecationMetadataIssue" | "StylesheetLoadingIssue" | "FederatedAuthUserInfoRequestIssue" | "PropertyRuleIssue" | "SharedDictionaryIssue" | "ElementAccessibilityIssue" | "SRIMessageSignatureIssue" | "UnencodedDigestIssue" | "ConnectionAllowlistIssue" | "UserReidentificationIssue" | "PermissionElementIssue" | "PerformanceIssue" | "SelectivePermissionsInterventionIssue";
  /**
   * This struct holds a list of optional fields with additional information
   * specific to the kind of issue. When adding a new issue code, please also
   * add a new optional field to this type.
   */
  export interface InspectorIssueDetails {
    cookieIssueDetails?: Audits.CookieIssueDetails;
    mixedContentIssueDetails?: Audits.MixedContentIssueDetails;
    blockedByResponseIssueDetails?: Audits.BlockedByResponseIssueDetails;
    heavyAdIssueDetails?: Audits.HeavyAdIssueDetails;
    contentSecurityPolicyIssueDetails?: Audits.ContentSecurityPolicyIssueDetails;
    sharedArrayBufferIssueDetails?: Audits.SharedArrayBufferIssueDetails;
    corsIssueDetails?: Audits.CorsIssueDetails;
    attributionReportingIssueDetails?: Audits.AttributionReportingIssueDetails;
    quirksModeIssueDetails?: Audits.QuirksModeIssueDetails;
    partitioningBlobURLIssueDetails?: Audits.PartitioningBlobURLIssueDetails;
    navigatorUserAgentIssueDetails?: Audits.NavigatorUserAgentIssueDetails;
    genericIssueDetails?: Audits.GenericIssueDetails;
    deprecationIssueDetails?: Audits.DeprecationIssueDetails;
    clientHintIssueDetails?: Audits.ClientHintIssueDetails;
    federatedAuthRequestIssueDetails?: Audits.FederatedAuthRequestIssueDetails;
    bounceTrackingIssueDetails?: Audits.BounceTrackingIssueDetails;
    cookieDeprecationMetadataIssueDetails?: Audits.CookieDeprecationMetadataIssueDetails;
    stylesheetLoadingIssueDetails?: Audits.StylesheetLoadingIssueDetails;
    propertyRuleIssueDetails?: Audits.PropertyRuleIssueDetails;
    federatedAuthUserInfoRequestIssueDetails?: Audits.FederatedAuthUserInfoRequestIssueDetails;
    sharedDictionaryIssueDetails?: Audits.SharedDictionaryIssueDetails;
    elementAccessibilityIssueDetails?: Audits.ElementAccessibilityIssueDetails;
    sriMessageSignatureIssueDetails?: Audits.SRIMessageSignatureIssueDetails;
    unencodedDigestIssueDetails?: Audits.UnencodedDigestIssueDetails;
    connectionAllowlistIssueDetails?: Audits.ConnectionAllowlistIssueDetails;
    userReidentificationIssueDetails?: Audits.UserReidentificationIssueDetails;
    permissionElementIssueDetails?: Audits.PermissionElementIssueDetails;
    performanceIssueDetails?: Audits.PerformanceIssueDetails;
    selectivePermissionsInterventionIssueDetails?: Audits.SelectivePermissionsInterventionIssueDetails;
  }
  /**
   * A unique id for a DevTools inspector issue. Allows other entities (e.g.
   * exceptions, CDP message, console messages, etc.) to reference an issue.
   */
  export type IssueId = string;
  export interface MixedContentIssueDetails {
    resourceType?: Audits.MixedContentResourceType;
    resolutionStatus: Audits.MixedContentResolutionStatus;
    insecureURL: string;
    mainResourceURL: string;
    request?: Audits.AffectedRequest;
    frame?: Audits.AffectedFrame;
  }
  export type MixedContentResolutionStatus = "MixedContentBlocked" | "MixedContentAutomaticallyUpgraded" | "MixedContentWarning";
  export type MixedContentResourceType = "AttributionSrc" | "Audio" | "Beacon" | "CSPReport" | "Download" | "EventSource" | "Favicon" | "Font" | "Form" | "Frame" | "Image" | "Import" | "JSON" | "Manifest" | "Ping" | "PluginData" | "PluginResource" | "Prefetch" | "Resource" | "Script" | "ServiceWorker" | "SharedWorker" | "SpeculationRules" | "Stylesheet" | "Track" | "Video" | "Worker" | "XMLHttpRequest" | "XSLT";
  /** @deprecated */
  export interface NavigatorUserAgentIssueDetails {
    url: string;
    location?: Audits.SourceCodeLocation;
  }
  export type PartitioningBlobURLInfo = "BlockedCrossPartitionFetching" | "EnforceNoopenerForNavigation";
  export interface PartitioningBlobURLIssueDetails {
    url: string;
    partitioningBlobURLInfo: Audits.PartitioningBlobURLInfo;
  }
  /** Details for a performance issue. */
  export interface PerformanceIssueDetails {
    performanceIssueType: Audits.PerformanceIssueType;
    sourceCodeLocation?: Audits.SourceCodeLocation;
  }
  export type PerformanceIssueType = "DocumentCookie";
  /** This issue warns about improper usage of the <permission> element. */
  export interface PermissionElementIssueDetails {
    issueType: Audits.PermissionElementIssueType;
    type?: string;
    nodeId?: DOM.BackendNodeId;
    isWarning?: boolean;
    permissionName?: string;
    occluderNodeInfo?: string;
    occluderParentNodeInfo?: string;
    disableReason?: string;
  }
  export type PermissionElementIssueType = "InvalidType" | "FencedFrameDisallowed" | "CspFrameAncestorsMissing" | "PermissionsPolicyBlocked" | "PaddingRightUnsupported" | "PaddingBottomUnsupported" | "InsetBoxShadowUnsupported" | "RequestInProgress" | "UntrustedEvent" | "RegistrationFailed" | "TypeNotSupported" | "InvalidTypeActivation" | "SecurityChecksFailed" | "ActivationDisabled" | "GeolocationDeprecated" | "InvalidDisplayStyle" | "NonOpaqueColor" | "LowContrast" | "FontSizeTooSmall" | "FontSizeTooLarge" | "InvalidSizeValue";
  /**
   * This issue warns about errors in property rules that lead to property
   * registrations being ignored.
   */
  export interface PropertyRuleIssueDetails {
    sourceCodeLocation: Audits.SourceCodeLocation;
    propertyRuleIssueReason: Audits.PropertyRuleIssueReason;
    propertyValue?: string;
  }
  export type PropertyRuleIssueReason = "InvalidSyntax" | "InvalidInitialValue" | "InvalidInherits" | "InvalidName";
  /**
   * Details for issues about documents in Quirks Mode
   * or Limited Quirks Mode that affects page layouting.
   */
  export interface QuirksModeIssueDetails {
    isLimitedQuirksMode: boolean;
    documentNodeId: DOM.BackendNodeId;
    url: string;
    frameId: Page.FrameId;
    loaderId: Network.LoaderId;
  }
  /**
   * The issue warns about blocked calls to privacy sensitive APIs via the
   * Selective Permissions Intervention.
   */
  export interface SelectivePermissionsInterventionIssueDetails {
    apiName: string;
    adAncestry: Network.AdAncestry;
    stackTrace?: Runtime.StackTrace;
  }
  /**
   * Details for a issue arising from an SAB being instantiated in, or
   * transferred to a context that is not cross-origin isolated.
   */
  export interface SharedArrayBufferIssueDetails {
    sourceCodeLocation: Audits.SourceCodeLocation;
    isWarning: boolean;
    type: Audits.SharedArrayBufferIssueType;
  }
  export type SharedArrayBufferIssueType = "TransferIssue" | "CreationIssue";
  export type SharedDictionaryError = "UseErrorCrossOriginNoCorsRequest" | "UseErrorDictionaryLoadFailure" | "UseErrorMatchingDictionaryNotUsed" | "UseErrorUnexpectedContentDictionaryHeader" | "WriteErrorCossOriginNoCorsRequest" | "WriteErrorDisallowedBySettings" | "WriteErrorExpiredResponse" | "WriteErrorFeatureDisabled" | "WriteErrorInsufficientResources" | "WriteErrorInvalidMatchField" | "WriteErrorInvalidStructuredHeader" | "WriteErrorInvalidTTLField" | "WriteErrorNavigationRequest" | "WriteErrorNoMatchField" | "WriteErrorNonIntegerTTLField" | "WriteErrorNonListMatchDestField" | "WriteErrorNonSecureContext" | "WriteErrorNonStringIdField" | "WriteErrorNonStringInMatchDestList" | "WriteErrorNonStringMatchField" | "WriteErrorNonTokenTypeField" | "WriteErrorRequestAborted" | "WriteErrorShuttingDown" | "WriteErrorTooLongIdField" | "WriteErrorUnsupportedType";
  export interface SharedDictionaryIssueDetails {
    sharedDictionaryError: Audits.SharedDictionaryError;
    request: Audits.AffectedRequest;
  }
  export interface SourceCodeLocation {
    scriptId?: Runtime.ScriptId;
    url: string;
    lineNumber: number;
    columnNumber: number;
  }
  export type SRIMessageSignatureError = "MissingSignatureHeader" | "MissingSignatureInputHeader" | "InvalidSignatureHeader" | "InvalidSignatureInputHeader" | "SignatureHeaderValueIsNotByteSequence" | "SignatureHeaderValueIsParameterized" | "SignatureHeaderValueIsIncorrectLength" | "SignatureInputHeaderMissingLabel" | "SignatureInputHeaderValueNotInnerList" | "SignatureInputHeaderValueMissingComponents" | "SignatureInputHeaderInvalidComponentType" | "SignatureInputHeaderInvalidComponentName" | "SignatureInputHeaderInvalidHeaderComponentParameter" | "SignatureInputHeaderInvalidDerivedComponentParameter" | "SignatureInputHeaderKeyIdLength" | "SignatureInputHeaderInvalidParameter" | "SignatureInputHeaderMissingRequiredParameters" | "ValidationFailedSignatureExpired" | "ValidationFailedInvalidLength" | "ValidationFailedSignatureMismatch" | "ValidationFailedIntegrityMismatch";
  export interface SRIMessageSignatureIssueDetails {
    error: Audits.SRIMessageSignatureError;
    signatureBase: string;
    integrityAssertions: string[];
    request: Audits.AffectedRequest;
  }
  /** This issue warns when a referenced stylesheet couldn't be loaded. */
  export interface StylesheetLoadingIssueDetails {
    sourceCodeLocation: Audits.SourceCodeLocation;
    styleSheetLoadingIssueReason: Audits.StyleSheetLoadingIssueReason;
    failedRequestInfo?: Audits.FailedRequestInfo;
  }
  export type StyleSheetLoadingIssueReason = "LateImportRule" | "RequestFailed";
  export type UnencodedDigestError = "MalformedDictionary" | "UnknownAlgorithm" | "IncorrectDigestType" | "IncorrectDigestLength";
  export interface UnencodedDigestIssueDetails {
    error: Audits.UnencodedDigestError;
    request: Audits.AffectedRequest;
  }
  /**
   * This issue warns about uses of APIs that may be considered misuse to
   * re-identify users.
   */
  export interface UserReidentificationIssueDetails {
    type: Audits.UserReidentificationIssueType;
    request?: Audits.AffectedRequest;
    sourceCodeLocation?: Audits.SourceCodeLocation;
  }
  export type UserReidentificationIssueType = "BlockedFrameNavigation" | "BlockedSubresource" | "NoisedCanvasReadback";
  /**
   * Runs the form issues check for the target page. Found issues are reported
   * using Audits.issueAdded event.
   */
  export interface CheckFormsIssuesRequest {}
  export interface CheckFormsIssuesResponse {
    formIssues: Audits.GenericIssueDetails[];
  }
  /** Disables issues domain, prevents further issues from being reported to the client. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables issues domain, sends the issues collected so far to the client by means of the
   * `issueAdded` event.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Returns the response body and size if it were re-encoded with the specified settings. Only
   * applies to images.
   */
  export interface GetEncodedResponseRequest {
    requestId: Network.RequestId;
    encoding: "webp" | "jpeg" | "png";
    quality?: number;
    sizeOnly?: boolean;
  }
  export interface GetEncodedResponseResponse {
    body?: string;
    originalSize: number;
    encodedSize: number;
  }
  export interface IssueAddedEvent {
    issue: Audits.InspectorIssue;
  }
}

/**
 * Defines commands and events for Autofill.
 * @experimental
 */
export namespace Autofill {
  export interface Address {
    fields: Autofill.AddressField[];
  }
  export interface AddressField {
    name: string;
    value: string;
  }
  /** A list of address fields. */
  export interface AddressFields {
    fields: Autofill.AddressField[];
  }
  /**
   * Defines how an address can be displayed like in chrome://settings/addresses.
   * Address UI is a two dimensional array, each inner array is an "address information line", and when rendered in a UI surface should be displayed as such.
   * The following address UI for instance:
   * [[{name: "GIVE_NAME", value: "Jon"}, {name: "FAMILY_NAME", value: "Doe"}], [{name: "CITY", value: "Munich"}, {name: "ZIP", value: "81456"}]]
   * should allow the receiver to render:
   * Jon Doe
   * Munich 81456
   */
  export interface AddressUI {
    addressFields: Autofill.AddressFields[];
  }
  export interface CreditCard {
    number: string;
    name: string;
    expiryMonth: string;
    expiryYear: string;
    cvc: string;
  }
  export interface FilledField {
    htmlType: string;
    id: string;
    name: string;
    value: string;
    autofillType: string;
    fillingStrategy: Autofill.FillingStrategy;
    frameId: Page.FrameId;
    fieldId: DOM.BackendNodeId;
  }
  /** Specified whether a filled field was done so by using the html autocomplete attribute or autofill heuristics. */
  export type FillingStrategy = "autocompleteAttribute" | "autofillInferred";
  /** Disables autofill domain notifications. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables autofill domain notifications. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Set addresses so that developers can verify their forms implementation. */
  export interface SetAddressesRequest {
    addresses: Autofill.Address[];
  }
  export interface SetAddressesResponse {}
  /**
   * Trigger autofill on a form identified by the fieldId.
   * If the field and related form cannot be autofilled, returns an error.
   */
  export interface TriggerRequest {
    fieldId: DOM.BackendNodeId;
    frameId?: Page.FrameId;
    card?: Autofill.CreditCard;
    address?: Autofill.Address;
  }
  export interface TriggerResponse {}
  /** Emitted when an address form is filled. */
  export interface AddressFormFilledEvent {
    filledFields: Autofill.FilledField[];
    addressUi: Autofill.AddressUI;
  }
}

/**
 * Defines events for background web platform features.
 * @experimental
 */
export namespace BackgroundService {
  export interface BackgroundServiceEvent {
    timestamp: Network.TimeSinceEpoch;
    origin: string;
    serviceWorkerRegistrationId: ServiceWorker.RegistrationID;
    service: BackgroundService.ServiceName;
    eventName: string;
    instanceId: string;
    eventMetadata: BackgroundService.EventMetadata[];
    storageKey: string;
  }
  /** A key-value pair for additional event information to pass along. */
  export interface EventMetadata {
    key: string;
    value: string;
  }
  /**
   * The Background Service that will be associated with the commands/events.
   * Every Background Service operates independently, but they share the same
   * API.
   */
  export type ServiceName = "backgroundFetch" | "backgroundSync" | "pushMessaging" | "notifications" | "paymentHandler" | "periodicBackgroundSync";
  /** Clears all stored data for the service. */
  export interface ClearEventsRequest {
    service: BackgroundService.ServiceName;
  }
  export interface ClearEventsResponse {}
  /** Set the recording state for the service. */
  export interface SetRecordingRequest {
    shouldRecord: boolean;
    service: BackgroundService.ServiceName;
  }
  export interface SetRecordingResponse {}
  /** Enables event updates for the service. */
  export interface StartObservingRequest {
    service: BackgroundService.ServiceName;
  }
  export interface StartObservingResponse {}
  /** Disables event updates for the service. */
  export interface StopObservingRequest {
    service: BackgroundService.ServiceName;
  }
  export interface StopObservingResponse {}
  /**
   * Called with all existing backgroundServiceEvents when enabled, and all new
   * events afterwards if enabled and recording.
   */
  export interface BackgroundServiceEventReceivedEvent {
    backgroundServiceEvent: BackgroundService.BackgroundServiceEvent;
  }
  /** Called when the recording state for the service has been updated. */
  export interface RecordingStateChangedEvent {
    isRecording: boolean;
    service: BackgroundService.ServiceName;
  }
}

/**
 * This domain allows configuring virtual Bluetooth devices to test
the web-bluetooth API.
 * @experimental
 */
export namespace BluetoothEmulation {
  /** Indicates the various states of Central. */
  export type CentralState = "absent" | "powered-off" | "powered-on";
  /** Indicates the various types of characteristic operation. */
  export type CharacteristicOperationType = "read" | "write" | "subscribe-to-notifications" | "unsubscribe-from-notifications";
  /**
   * Describes the properties of a characteristic. This follows Bluetooth Core
   * Specification BT 4.2 Vol 3 Part G 3.3.1. Characteristic Properties.
   */
  export interface CharacteristicProperties {
    broadcast?: boolean;
    read?: boolean;
    writeWithoutResponse?: boolean;
    write?: boolean;
    notify?: boolean;
    indicate?: boolean;
    authenticatedSignedWrites?: boolean;
    extendedProperties?: boolean;
  }
  /** Indicates the various types of characteristic write. */
  export type CharacteristicWriteType = "write-default-deprecated" | "write-with-response" | "write-without-response";
  /** Indicates the various types of descriptor operation. */
  export type DescriptorOperationType = "read" | "write";
  /** Indicates the various types of GATT event. */
  export type GATTOperationType = "connection" | "discovery";
  /** Stores the manufacturer data */
  export interface ManufacturerData {
    key: number;
    data: string;
  }
  /** Stores the advertisement packet information that is sent by a Bluetooth device. */
  export interface ScanEntry {
    deviceAddress: string;
    rssi: number;
    scanRecord: BluetoothEmulation.ScanRecord;
  }
  /** Stores the byte data of the advertisement packet sent by a Bluetooth device. */
  export interface ScanRecord {
    name?: string;
    uuids?: string[];
    appearance?: number;
    txPower?: number;
    manufacturerData?: BluetoothEmulation.ManufacturerData[];
  }
  /**
   * Adds a characteristic with |characteristicUuid| and |properties| to the
   * service represented by |serviceId|.
   */
  export interface AddCharacteristicRequest {
    serviceId: string;
    characteristicUuid: string;
    properties: BluetoothEmulation.CharacteristicProperties;
  }
  export interface AddCharacteristicResponse {
    characteristicId: string;
  }
  /**
   * Adds a descriptor with |descriptorUuid| to the characteristic respresented
   * by |characteristicId|.
   */
  export interface AddDescriptorRequest {
    characteristicId: string;
    descriptorUuid: string;
  }
  export interface AddDescriptorResponse {
    descriptorId: string;
  }
  /** Adds a service with |serviceUuid| to the peripheral with |address|. */
  export interface AddServiceRequest {
    address: string;
    serviceUuid: string;
  }
  export interface AddServiceResponse {
    serviceId: string;
  }
  /** Disable the BluetoothEmulation domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enable the BluetoothEmulation domain. */
  export interface EnableRequest {
    state: BluetoothEmulation.CentralState;
    leSupported: boolean;
  }
  export interface EnableResponse {}
  /**
   * Removes the characteristic respresented by |characteristicId| from the
   * simulated central.
   */
  export interface RemoveCharacteristicRequest {
    characteristicId: string;
  }
  export interface RemoveCharacteristicResponse {}
  /** Removes the descriptor with |descriptorId| from the simulated central. */
  export interface RemoveDescriptorRequest {
    descriptorId: string;
  }
  export interface RemoveDescriptorResponse {}
  /** Removes the service respresented by |serviceId| from the simulated central. */
  export interface RemoveServiceRequest {
    serviceId: string;
  }
  export interface RemoveServiceResponse {}
  /** Set the state of the simulated central. */
  export interface SetSimulatedCentralStateRequest {
    state: BluetoothEmulation.CentralState;
  }
  export interface SetSimulatedCentralStateResponse {}
  /**
   * Simulates an advertisement packet described in |entry| being received by
   * the central.
   */
  export interface SimulateAdvertisementRequest {
    entry: BluetoothEmulation.ScanEntry;
  }
  export interface SimulateAdvertisementResponse {}
  /**
   * Simulates the response from the characteristic with |characteristicId| for a
   * characteristic operation of |type|. The |code| value follows the Error
   * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
   * The |data| is expected to exist when simulating a successful read operation
   * response.
   */
  export interface SimulateCharacteristicOperationResponseRequest {
    characteristicId: string;
    type: BluetoothEmulation.CharacteristicOperationType;
    code: number;
    data?: string;
  }
  export interface SimulateCharacteristicOperationResponseResponse {}
  /**
   * Simulates the response from the descriptor with |descriptorId| for a
   * descriptor operation of |type|. The |code| value follows the Error
   * Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
   * The |data| is expected to exist when simulating a successful read operation
   * response.
   */
  export interface SimulateDescriptorOperationResponseRequest {
    descriptorId: string;
    type: BluetoothEmulation.DescriptorOperationType;
    code: number;
    data?: string;
  }
  export interface SimulateDescriptorOperationResponseResponse {}
  /** Simulates a GATT disconnection from the peripheral with |address|. */
  export interface SimulateGATTDisconnectionRequest {
    address: string;
  }
  export interface SimulateGATTDisconnectionResponse {}
  /**
   * Simulates the response code from the peripheral with |address| for a
   * GATT operation of |type|. The |code| value follows the HCI Error Codes from
   * Bluetooth Core Specification Vol 2 Part D 1.3 List Of Error Codes.
   */
  export interface SimulateGATTOperationResponseRequest {
    address: string;
    type: BluetoothEmulation.GATTOperationType;
    code: number;
  }
  export interface SimulateGATTOperationResponseResponse {}
  /**
   * Simulates a peripheral with |address|, |name| and |knownServiceUuids|
   * that has already been connected to the system.
   */
  export interface SimulatePreconnectedPeripheralRequest {
    address: string;
    name: string;
    manufacturerData: BluetoothEmulation.ManufacturerData[];
    knownServiceUuids: string[];
  }
  export interface SimulatePreconnectedPeripheralResponse {}
  /**
   * Event for when a characteristic operation of |type| to the characteristic
   * respresented by |characteristicId| happened. |data| and |writeType| is
   * expected to exist when |type| is write.
   */
  export interface CharacteristicOperationReceivedEvent {
    characteristicId: string;
    type: BluetoothEmulation.CharacteristicOperationType;
    data?: string;
    writeType?: BluetoothEmulation.CharacteristicWriteType;
  }
  /**
   * Event for when a descriptor operation of |type| to the descriptor
   * respresented by |descriptorId| happened. |data| is expected to exist when
   * |type| is write.
   */
  export interface DescriptorOperationReceivedEvent {
    descriptorId: string;
    type: BluetoothEmulation.DescriptorOperationType;
    data?: string;
  }
  /**
   * Event for when a GATT operation of |type| to the peripheral with |address|
   * happened.
   */
  export interface GattOperationReceivedEvent {
    address: string;
    type: BluetoothEmulation.GATTOperationType;
  }
}

/**
 * The Browser domain defines methods and events for browser managing.
 */
export namespace Browser {
  /**
   * Browser window bounds information
   * @experimental
   */
  export interface Bounds {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    windowState?: Browser.WindowState;
  }
  /**
   * Browser command ids used by executeBrowserCommand.
   * @experimental
   */
  export type BrowserCommandId = "openTabSearch" | "closeTabSearch" | "openGlic";
  /** @experimental */
  export type BrowserContextID = string;
  /**
   * Chrome histogram bucket.
   * @experimental
   */
  export interface Bucket {
    low: number;
    high: number;
    count: number;
  }
  /**
   * Chrome histogram.
   * @experimental
   */
  export interface Histogram {
    name: string;
    sum: number;
    count: number;
    buckets: Browser.Bucket[];
  }
  /**
   * Definition of PermissionDescriptor defined in the Permissions API:
   * https://w3c.github.io/permissions/#dom-permissiondescriptor.
   * @experimental
   */
  export interface PermissionDescriptor {
    name: string;
    sysex?: boolean;
    userVisibleOnly?: boolean;
    allowWithoutSanitization?: boolean;
    allowWithoutGesture?: boolean;
    panTiltZoom?: boolean;
  }
  /** @experimental */
  export type PermissionSetting = "granted" | "denied" | "prompt";
  /** @experimental */
  export type PermissionType = "ar" | "audioCapture" | "automaticFullscreen" | "backgroundFetch" | "backgroundSync" | "cameraPanTiltZoom" | "capturedSurfaceControl" | "clipboardReadWrite" | "clipboardSanitizedWrite" | "displayCapture" | "durableStorage" | "geolocation" | "handTracking" | "idleDetection" | "keyboardLock" | "localFonts" | "localNetwork" | "localNetworkAccess" | "loopbackNetwork" | "midi" | "midiSysex" | "nfc" | "notifications" | "paymentHandler" | "periodicBackgroundSync" | "pointerLock" | "protectedMediaIdentifier" | "sensors" | "smartCard" | "speakerSelection" | "storageAccess" | "topLevelStorageAccess" | "videoCapture" | "vr" | "wakeLockScreen" | "wakeLockSystem" | "webAppInstallation" | "webPrinting" | "windowManagement";
  /** @experimental */
  export type PrivacySandboxAPI = "BiddingAndAuctionServices" | "TrustedKeyValue";
  /** @experimental */
  export type WindowID = number;
  /**
   * The state of the browser window.
   * @experimental
   */
  export type WindowState = "normal" | "minimized" | "maximized" | "fullscreen";
  /**
   * Configures encryption keys used with a given privacy sandbox API to talk
   * to a trusted coordinator.  Since this is intended for test automation only,
   * coordinatorOrigin must be a .test domain. No existing coordinator
   * configuration for the origin may exist.
   */
  export interface AddPrivacySandboxCoordinatorKeyConfigRequest {
    api: Browser.PrivacySandboxAPI;
    coordinatorOrigin: string;
    keyConfig: string;
    browserContextId?: Browser.BrowserContextID;
  }
  export interface AddPrivacySandboxCoordinatorKeyConfigResponse {}
  /**
   * Allows a site to use privacy sandbox features that require enrollment
   * without the site actually being enrolled. Only supported on page targets.
   */
  export interface AddPrivacySandboxEnrollmentOverrideRequest {
    url: string;
  }
  export interface AddPrivacySandboxEnrollmentOverrideResponse {}
  /**
   * Cancel a download if in progress
   * @experimental
   */
  export interface CancelDownloadRequest {
    guid: string;
    browserContextId?: Browser.BrowserContextID;
  }
  export interface CancelDownloadResponse {}
  /** Close browser gracefully. */
  export interface CloseRequest {}
  export interface CloseResponse {}
  /**
   * Crashes browser on the main thread.
   * @experimental
   */
  export interface CrashRequest {}
  export interface CrashResponse {}
  /**
   * Crashes GPU process.
   * @experimental
   */
  export interface CrashGpuProcessRequest {}
  export interface CrashGpuProcessResponse {}
  /**
   * Invoke custom browser commands used by telemetry.
   * @experimental
   */
  export interface ExecuteBrowserCommandRequest {
    commandId: Browser.BrowserCommandId;
  }
  export interface ExecuteBrowserCommandResponse {}
  /**
   * Returns the command line switches for the browser process if, and only if
   * --enable-automation is on the commandline.
   * @experimental
   */
  export interface GetBrowserCommandLineRequest {}
  export interface GetBrowserCommandLineResponse {
    arguments: string[];
  }
  /**
   * Get a Chrome histogram by name.
   * @experimental
   */
  export interface GetHistogramRequest {
    name: string;
    delta?: boolean;
  }
  export interface GetHistogramResponse {
    histogram: Browser.Histogram;
  }
  /**
   * Get Chrome histograms.
   * @experimental
   */
  export interface GetHistogramsRequest {
    query?: string;
    delta?: boolean;
  }
  export interface GetHistogramsResponse {
    histograms: Browser.Histogram[];
  }
  /** Returns version information. */
  export interface GetVersionRequest {}
  export interface GetVersionResponse {
    protocolVersion: string;
    product: string;
    revision: string;
    userAgent: string;
    jsVersion: string;
  }
  /**
   * Get position and size of the browser window.
   * @experimental
   */
  export interface GetWindowBoundsRequest {
    windowId: Browser.WindowID;
  }
  export interface GetWindowBoundsResponse {
    bounds: Browser.Bounds;
  }
  /**
   * Get the browser window that contains the devtools target.
   * @experimental
   */
  export interface GetWindowForTargetRequest {
    targetId?: Target.TargetID;
  }
  export interface GetWindowForTargetResponse {
    windowId: Browser.WindowID;
    bounds: Browser.Bounds;
  }
  /**
   * Grant specific permissions to the given origin and reject all others. Deprecated. Use
   * setPermission instead.
   * @experimental
   * @deprecated
   */
  export interface GrantPermissionsRequest {
    permissions: Browser.PermissionType[];
    origin?: string;
    browserContextId?: Browser.BrowserContextID;
  }
  export interface GrantPermissionsResponse {}
  /** Reset all permission management for all origins. */
  export interface ResetPermissionsRequest {
    browserContextId?: Browser.BrowserContextID;
  }
  export interface ResetPermissionsResponse {}
  /**
   * Set size of the browser contents resizing browser window as necessary.
   * @experimental
   */
  export interface SetContentsSizeRequest {
    windowId: Browser.WindowID;
    width?: number;
    height?: number;
  }
  export interface SetContentsSizeResponse {}
  /**
   * Set dock tile details, platform-specific.
   * @experimental
   */
  export interface SetDockTileRequest {
    badgeLabel?: string;
    image?: string;
  }
  export interface SetDockTileResponse {}
  /**
   * Set the behavior when downloading a file.
   * @experimental
   */
  export interface SetDownloadBehaviorRequest {
    behavior: "deny" | "allow" | "allowAndName" | "default";
    browserContextId?: Browser.BrowserContextID;
    downloadPath?: string;
    eventsEnabled?: boolean;
  }
  export interface SetDownloadBehaviorResponse {}
  /**
   * Set permission settings for given embedding and embedded origins.
   * @experimental
   */
  export interface SetPermissionRequest {
    permission: Browser.PermissionDescriptor;
    setting: Browser.PermissionSetting;
    origin?: string;
    embeddedOrigin?: string;
    browserContextId?: Browser.BrowserContextID;
  }
  export interface SetPermissionResponse {}
  /**
   * Set position and/or size of the browser window.
   * @experimental
   */
  export interface SetWindowBoundsRequest {
    windowId: Browser.WindowID;
    bounds: Browser.Bounds;
  }
  export interface SetWindowBoundsResponse {}
  /**
   * Fired when download makes progress. Last call has |done| == true.
   * @experimental
   */
  export interface DownloadProgressEvent {
    guid: string;
    totalBytes: number;
    receivedBytes: number;
    state: "inProgress" | "completed" | "canceled";
    filePath?: string;
  }
  /**
   * Fired when page is about to start a download.
   * @experimental
   */
  export interface DownloadWillBeginEvent {
    frameId: Page.FrameId;
    guid: string;
    url: string;
    suggestedFilename: string;
  }
}

/**
 * CacheStorage
 * @experimental
 */
export namespace CacheStorage {
  /** Cache identifier. */
  export interface Cache {
    cacheId: CacheStorage.CacheId;
    securityOrigin: string;
    storageKey: string;
    storageBucket?: Storage.StorageBucket;
    cacheName: string;
  }
  /** Cached response */
  export interface CachedResponse {
    body: string;
  }
  /** type of HTTP response cached */
  export type CachedResponseType = "basic" | "cors" | "default" | "error" | "opaqueResponse" | "opaqueRedirect";
  /** Unique identifier of the Cache object. */
  export type CacheId = string;
  /** Data entry. */
  export interface DataEntry {
    requestURL: string;
    requestMethod: string;
    requestHeaders: CacheStorage.Header[];
    responseTime: number;
    responseStatus: number;
    responseStatusText: string;
    responseType: CacheStorage.CachedResponseType;
    responseHeaders: CacheStorage.Header[];
  }
  export interface Header {
    name: string;
    value: string;
  }
  /** Deletes a cache. */
  export interface DeleteCacheRequest {
    cacheId: CacheStorage.CacheId;
  }
  export interface DeleteCacheResponse {}
  /** Deletes a cache entry. */
  export interface DeleteEntryRequest {
    cacheId: CacheStorage.CacheId;
    request: string;
  }
  export interface DeleteEntryResponse {}
  /** Fetches cache entry. */
  export interface RequestCachedResponseRequest {
    cacheId: CacheStorage.CacheId;
    requestURL: string;
    requestHeaders: CacheStorage.Header[];
  }
  export interface RequestCachedResponseResponse {
    response: CacheStorage.CachedResponse;
  }
  /** Requests cache names. */
  export interface RequestCacheNamesRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
  }
  export interface RequestCacheNamesResponse {
    caches: CacheStorage.Cache[];
  }
  /** Requests data from cache. */
  export interface RequestEntriesRequest {
    cacheId: CacheStorage.CacheId;
    skipCount?: number;
    pageSize?: number;
    pathFilter?: string;
  }
  export interface RequestEntriesResponse {
    cacheDataEntries: CacheStorage.DataEntry[];
    returnCount: number;
  }
}

/**
 * A domain for interacting with Cast, Presentation API, and Remote Playback API
functionalities.
 * @experimental
 */
export namespace Cast {
  export interface Sink {
    name: string;
    id: string;
    session?: string;
  }
  /** Stops observing for sinks and issues. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Starts observing for sinks that can be used for tab mirroring, and if set,
   * sinks compatible with |presentationUrl| as well. When sinks are found, a
   * |sinksUpdated| event is fired.
   * Also starts observing for issue messages. When an issue is added or removed,
   * an |issueUpdated| event is fired.
   */
  export interface EnableRequest {
    presentationUrl?: string;
  }
  export interface EnableResponse {}
  /**
   * Sets a sink to be used when the web page requests the browser to choose a
   * sink via Presentation API, Remote Playback API, or Cast SDK.
   */
  export interface SetSinkToUseRequest {
    sinkName: string;
  }
  export interface SetSinkToUseResponse {}
  /** Starts mirroring the desktop to the sink. */
  export interface StartDesktopMirroringRequest {
    sinkName: string;
  }
  export interface StartDesktopMirroringResponse {}
  /** Starts mirroring the tab to the sink. */
  export interface StartTabMirroringRequest {
    sinkName: string;
  }
  export interface StartTabMirroringResponse {}
  /** Stops the active Cast session on the sink. */
  export interface StopCastingRequest {
    sinkName: string;
  }
  export interface StopCastingResponse {}
  /**
   * This is fired whenever the outstanding issue/error message changes.
   * |issueMessage| is empty if there is no issue.
   */
  export interface IssueUpdatedEvent {
    issueMessage: string;
  }
  /**
   * This is fired whenever the list of available sinks changes. A sink is a
   * device or a software surface that you can cast to.
   */
  export interface SinksUpdatedEvent {
    sinks: Cast.Sink[];
  }
}

/**
 * This domain is deprecated - use Runtime or Log instead.
 * @deprecated
 */
export namespace Console {
  /** Console message. */
  export interface ConsoleMessage {
    source: "xml" | "javascript" | "network" | "console-api" | "storage" | "appcache" | "rendering" | "security" | "other" | "deprecation" | "worker";
    level: "log" | "warning" | "error" | "debug" | "info";
    text: string;
    url?: string;
    line?: number;
    column?: number;
  }
  /** Does nothing. */
  export interface ClearMessagesRequest {}
  export interface ClearMessagesResponse {}
  /** Disables console domain, prevents further console messages from being reported to the client. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables console domain, sends the messages collected so far to the client by means of the
   * `messageAdded` notification.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Issued when new console message is added. */
  export interface MessageAddedEvent {
    message: Console.ConsoleMessage;
  }
}

/**
 * This domain exposes the current state of the CrashReportContext API.
 * @experimental
 */
export namespace CrashReportContext {
  /** Key-value pair in CrashReportContext. */
  export interface CrashReportContextEntry {
    key: string;
    value: string;
    frameId: Page.FrameId;
  }
  /** Returns all entries in the CrashReportContext across all frames in the page. */
  export interface GetEntriesRequest {}
  export interface GetEntriesResponse {
    entries: CrashReportContext.CrashReportContextEntry[];
  }
}

/**
 * This domain exposes CSS read/write operations. All CSS objects (stylesheets, rules, and styles)
have an associated `id` used in subsequent operations on the related object. Each object type has
a specific `id` structure, and those are not interchangeable between objects of different kinds.
CSS objects can be loaded using the `get*ForNode()` calls (which accept a DOM node id). A client
can also keep track of stylesheets via the `styleSheetAdded`/`styleSheetRemoved` events and
subsequently load the required stylesheet contents using the `getStyleSheet[Text]()` methods.
 * @experimental
 */
export namespace CSS {
  /** @experimental */
  export interface ComputedStyleExtraFields {
    isAppearanceBase: boolean;
  }
  /** CSS style coming from animations with the name of the animation. */
  export interface CSSAnimationStyle {
    name?: string;
    style: CSS.CSSStyle;
  }
  /** CSS generic @rule representation. */
  export interface CSSAtRule {
    type: "font-face" | "font-feature-values" | "font-palette-values";
    subsection?: "swash" | "annotation" | "ornaments" | "stylistic" | "styleset" | "character-variant";
    name?: CSS.Value;
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    style: CSS.CSSStyle;
  }
  export interface CSSComputedStyleProperty {
    name: string;
    value: string;
  }
  /**
   * CSS container query rule descriptor.
   * @experimental
   */
  export interface CSSContainerQuery {
    text: string;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
    name?: string;
    physicalAxes?: DOM.PhysicalAxes;
    logicalAxes?: DOM.LogicalAxes;
    queriesScrollState?: boolean;
    queriesAnchored?: boolean;
  }
  /** CSS function conditional block representation. */
  export interface CSSFunctionConditionNode {
    media?: CSS.CSSMedia;
    containerQueries?: CSS.CSSContainerQuery;
    supports?: CSS.CSSSupports;
    navigation?: CSS.CSSNavigation;
    children: CSS.CSSFunctionNode[];
    conditionText: string;
  }
  /** Section of the body of a CSS function rule. */
  export interface CSSFunctionNode {
    condition?: CSS.CSSFunctionConditionNode;
    style?: CSS.CSSStyle;
  }
  /** CSS function argument representation. */
  export interface CSSFunctionParameter {
    name: string;
    type: string;
  }
  /** CSS function at-rule representation. */
  export interface CSSFunctionRule {
    name: CSS.Value;
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    parameters: CSS.CSSFunctionParameter[];
    children: CSS.CSSFunctionNode[];
    originTreeScopeNodeId?: DOM.BackendNodeId;
  }
  /** CSS keyframe rule representation. */
  export interface CSSKeyframeRule {
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    keyText: CSS.Value;
    style: CSS.CSSStyle;
  }
  /** CSS keyframes rule representation. */
  export interface CSSKeyframesRule {
    animationName: CSS.Value;
    keyframes: CSS.CSSKeyframeRule[];
  }
  /**
   * CSS Layer at-rule descriptor.
   * @experimental
   */
  export interface CSSLayer {
    text: string;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
  }
  /**
   * CSS Layer data.
   * @experimental
   */
  export interface CSSLayerData {
    name: string;
    subLayers?: CSS.CSSLayerData[];
    order: number;
  }
  /** CSS media rule descriptor. */
  export interface CSSMedia {
    text: string;
    source: "mediaRule" | "importRule" | "linkedSheet" | "inlineSheet";
    sourceURL?: string;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
    mediaList?: CSS.MediaQuery[];
  }
  /**
   * CSS Navigation at-rule descriptor.
   * @experimental
   */
  export interface CSSNavigation {
    text: string;
    active?: boolean;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
  }
  /** CSS @position-try rule representation. */
  export interface CSSPositionTryRule {
    name: CSS.Value;
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    style: CSS.CSSStyle;
    active: boolean;
  }
  /** CSS property declaration data. */
  export interface CSSProperty {
    name: string;
    value: string;
    important?: boolean;
    implicit?: boolean;
    text?: string;
    parsedOk?: boolean;
    disabled?: boolean;
    range?: CSS.SourceRange;
    longhandProperties?: CSS.CSSProperty[];
  }
  /** Representation of a custom property registration through CSS.registerProperty */
  export interface CSSPropertyRegistration {
    propertyName: string;
    initialValue?: CSS.Value;
    inherits: boolean;
    syntax: string;
  }
  /** CSS property at-rule representation. */
  export interface CSSPropertyRule {
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    propertyName: CSS.Value;
    style: CSS.CSSStyle;
  }
  /** CSS rule representation. */
  export interface CSSRule {
    styleSheetId?: DOM.StyleSheetId;
    selectorList: CSS.SelectorList;
    nestingSelectors?: string[];
    origin: CSS.StyleSheetOrigin;
    style: CSS.CSSStyle;
    originTreeScopeNodeId?: DOM.BackendNodeId;
    media?: CSS.CSSMedia[];
    containerQueries?: CSS.CSSContainerQuery[];
    supports?: CSS.CSSSupports[];
    layers?: CSS.CSSLayer[];
    scopes?: CSS.CSSScope[];
    ruleTypes?: CSS.CSSRuleType[];
    startingStyles?: CSS.CSSStartingStyle[];
    navigations?: CSS.CSSNavigation[];
  }
  /**
   * Enum indicating the type of a CSS rule, used to represent the order of a style rule's ancestors.
   * This list only contains rule types that are collected during the ancestor rule collection.
   * @experimental
   */
  export type CSSRuleType = "MediaRule" | "SupportsRule" | "ContainerRule" | "LayerRule" | "ScopeRule" | "StyleRule" | "StartingStyleRule" | "NavigationRule";
  /**
   * CSS Scope at-rule descriptor.
   * @experimental
   */
  export interface CSSScope {
    text: string;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
  }
  /**
   * CSS Starting Style at-rule descriptor.
   * @experimental
   */
  export interface CSSStartingStyle {
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
  }
  /** CSS style representation. */
  export interface CSSStyle {
    styleSheetId?: DOM.StyleSheetId;
    cssProperties: CSS.CSSProperty[];
    shorthandEntries: CSS.ShorthandEntry[];
    cssText?: string;
    range?: CSS.SourceRange;
  }
  /** CSS stylesheet metainformation. */
  export interface CSSStyleSheetHeader {
    styleSheetId: DOM.StyleSheetId;
    frameId: Page.FrameId;
    sourceURL: string;
    sourceMapURL?: string;
    origin: CSS.StyleSheetOrigin;
    title: string;
    ownerNode?: DOM.BackendNodeId;
    disabled: boolean;
    hasSourceURL?: boolean;
    isInline: boolean;
    isMutable: boolean;
    isConstructed: boolean;
    startLine: number;
    startColumn: number;
    length: number;
    endLine: number;
    endColumn: number;
    loadingFailed?: boolean;
  }
  /**
   * CSS Supports at-rule descriptor.
   * @experimental
   */
  export interface CSSSupports {
    text: string;
    active: boolean;
    range?: CSS.SourceRange;
    styleSheetId?: DOM.StyleSheetId;
  }
  /** CSS try rule representation. */
  export interface CSSTryRule {
    styleSheetId?: DOM.StyleSheetId;
    origin: CSS.StyleSheetOrigin;
    style: CSS.CSSStyle;
  }
  /**
   * Properties of a web font: https://www.w3.org/TR/2008/REC-CSS2-20080411/fonts.html#font-descriptions
   * and additional information such as platformFontFamily and fontVariationAxes.
   */
  export interface FontFace {
    fontFamily: string;
    fontStyle: string;
    fontVariant: string;
    fontWeight: string;
    fontStretch: string;
    fontDisplay: string;
    unicodeRange: string;
    src: string;
    platformFontFamily: string;
    fontVariationAxes?: CSS.FontVariationAxis[];
  }
  /** Information about font variation axes for variable fonts */
  export interface FontVariationAxis {
    tag: string;
    name: string;
    minValue: number;
    maxValue: number;
    defaultValue: number;
  }
  /** Inherited CSS style collection for animated styles from ancestor node. */
  export interface InheritedAnimatedStyleEntry {
    animationStyles?: CSS.CSSAnimationStyle[];
    transitionsStyle?: CSS.CSSStyle;
  }
  /** Inherited pseudo element matches from pseudos of an ancestor node. */
  export interface InheritedPseudoElementMatches {
    pseudoElements: CSS.PseudoElementMatches[];
  }
  /** Inherited CSS rule collection from ancestor node. */
  export interface InheritedStyleEntry {
    inlineStyle?: CSS.CSSStyle;
    matchedCSSRules: CSS.RuleMatch[];
  }
  /** Media query descriptor. */
  export interface MediaQuery {
    expressions: CSS.MediaQueryExpression[];
    active: boolean;
  }
  /** Media query expression descriptor. */
  export interface MediaQueryExpression {
    value: number;
    unit: string;
    feature: string;
    valueRange?: CSS.SourceRange;
    computedLength?: number;
  }
  /** Information about amount of glyphs that were rendered with given font. */
  export interface PlatformFontUsage {
    familyName: string;
    postScriptName: string;
    isCustomFont: boolean;
    glyphCount: number;
  }
  /** CSS rule collection for a single pseudo style. */
  export interface PseudoElementMatches {
    pseudoType: DOM.PseudoType;
    pseudoIdentifier?: string;
    matches: CSS.RuleMatch[];
  }
  /** Match data for a CSS rule. */
  export interface RuleMatch {
    rule: CSS.CSSRule;
    matchingSelectors: number[];
  }
  /** CSS coverage information. */
  export interface RuleUsage {
    styleSheetId: DOM.StyleSheetId;
    startOffset: number;
    endOffset: number;
    used: boolean;
  }
  /** Selector list data. */
  export interface SelectorList {
    selectors: CSS.Value[];
    text: string;
  }
  export interface ShorthandEntry {
    name: string;
    value: string;
    important?: boolean;
  }
  /** Text range within a resource. All numbers are zero-based. */
  export interface SourceRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }
  /**
   * Specificity:
   * https://drafts.csswg.org/selectors/#specificity-rules
   * @experimental
   */
  export interface Specificity {
    a: number;
    b: number;
    c: number;
  }
  /** A descriptor of operation to mutate style declaration text. */
  export interface StyleDeclarationEdit {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  /**
   * Stylesheet type: "injected" for stylesheets injected via extension, "user-agent" for user-agent
   * stylesheets, "inspector" for stylesheets created by the inspector (i.e. those holding the "via
   * inspector" rules), "regular" for regular stylesheets.
   */
  export type StyleSheetOrigin = "injected" | "user-agent" | "inspector" | "regular";
  /** Data for a simple selector (these are delimited by commas in a selector list). */
  export interface Value {
    text: string;
    range?: CSS.SourceRange;
    specificity?: CSS.Specificity;
  }
  /**
   * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
   * position specified by `location`.
   */
  export interface AddRuleRequest {
    styleSheetId: DOM.StyleSheetId;
    ruleText: string;
    location: CSS.SourceRange;
    nodeForPropertySyntaxValidation?: DOM.NodeId;
  }
  export interface AddRuleResponse {
    rule: CSS.CSSRule;
  }
  /** Returns all class names from specified stylesheet. */
  export interface CollectClassNamesRequest {
    styleSheetId: DOM.StyleSheetId;
  }
  export interface CollectClassNamesResponse {
    classNames: string[];
  }
  /** Creates a new special "via-inspector" stylesheet in the frame with given `frameId`. */
  export interface CreateStyleSheetRequest {
    frameId: Page.FrameId;
    force?: boolean;
  }
  export interface CreateStyleSheetResponse {
    styleSheetId: DOM.StyleSheetId;
  }
  /** Disables the CSS agent for the given page. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been
   * enabled until the result of this command is received.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Ensures that the given node will have specified pseudo-classes whenever its style is computed by
   * the browser.
   */
  export interface ForcePseudoStateRequest {
    nodeId: DOM.NodeId;
    forcedPseudoClasses: string[];
  }
  export interface ForcePseudoStateResponse {}
  /** Ensures that the given node is in its starting-style state. */
  export interface ForceStartingStyleRequest {
    nodeId: DOM.NodeId;
    forced: boolean;
  }
  export interface ForceStartingStyleResponse {}
  /**
   * Returns the styles coming from animations & transitions
   * including the animation & transition styles coming from inheritance chain.
   * @experimental
   */
  export interface GetAnimatedStylesForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetAnimatedStylesForNodeResponse {
    animationStyles?: CSS.CSSAnimationStyle[];
    transitionsStyle?: CSS.CSSStyle;
    inherited?: CSS.InheritedAnimatedStyleEntry[];
  }
  export interface GetBackgroundColorsRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetBackgroundColorsResponse {
    backgroundColors?: string[];
    computedFontSize?: string;
    computedFontWeight?: string;
  }
  /** Returns the computed style for a DOM node identified by `nodeId`. */
  export interface GetComputedStyleForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetComputedStyleForNodeResponse {
    computedStyle: CSS.CSSComputedStyleProperty[];
    extraFields: CSS.ComputedStyleExtraFields;
  }
  /**
   * Returns the values of the default UA-defined environment variables used in env()
   * @experimental
   */
  export interface GetEnvironmentVariablesRequest {}
  export interface GetEnvironmentVariablesResponse {
    environmentVariables: Record<string, unknown>;
  }
  /**
   * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
   * attributes) for a DOM node identified by `nodeId`.
   */
  export interface GetInlineStylesForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetInlineStylesForNodeResponse {
    inlineStyle?: CSS.CSSStyle;
    attributesStyle?: CSS.CSSStyle;
  }
  /**
   * Returns all layers parsed by the rendering engine for the tree scope of a node.
   * Given a DOM element identified by nodeId, getLayersForNode returns the root
   * layer for the nearest ancestor document or shadow root. The layer root contains
   * the full layer tree for the tree scope and their ordering.
   * @experimental
   */
  export interface GetLayersForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetLayersForNodeResponse {
    rootLayer: CSS.CSSLayerData;
  }
  /**
   * Given a CSS selector text and a style sheet ID, getLocationForSelector
   * returns an array of locations of the CSS selector in the style sheet.
   * @experimental
   */
  export interface GetLocationForSelectorRequest {
    styleSheetId: DOM.StyleSheetId;
    selectorText: string;
  }
  export interface GetLocationForSelectorResponse {
    ranges: CSS.SourceRange[];
  }
  /** @experimental */
  export interface GetLonghandPropertiesRequest {
    shorthandName: string;
    value: string;
  }
  export interface GetLonghandPropertiesResponse {
    longhandProperties: CSS.CSSProperty[];
  }
  /** Returns requested styles for a DOM node identified by `nodeId`. */
  export interface GetMatchedStylesForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetMatchedStylesForNodeResponse {
    inlineStyle?: CSS.CSSStyle;
    attributesStyle?: CSS.CSSStyle;
    matchedCSSRules?: CSS.RuleMatch[];
    pseudoElements?: CSS.PseudoElementMatches[];
    inherited?: CSS.InheritedStyleEntry[];
    inheritedPseudoElements?: CSS.InheritedPseudoElementMatches[];
    cssKeyframesRules?: CSS.CSSKeyframesRule[];
    cssPositionTryRules?: CSS.CSSPositionTryRule[];
    activePositionFallbackIndex?: number;
    cssPropertyRules?: CSS.CSSPropertyRule[];
    cssPropertyRegistrations?: CSS.CSSPropertyRegistration[];
    cssAtRules?: CSS.CSSAtRule[];
    parentLayoutNodeId?: DOM.NodeId;
    cssFunctionRules?: CSS.CSSFunctionRule[];
  }
  /** Returns all media queries parsed by the rendering engine. */
  export interface GetMediaQueriesRequest {}
  export interface GetMediaQueriesResponse {
    medias: CSS.CSSMedia[];
  }
  /**
   * Requests information about platform fonts which we used to render child TextNodes in the given
   * node.
   */
  export interface GetPlatformFontsForNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetPlatformFontsForNodeResponse {
    fonts: CSS.PlatformFontUsage[];
  }
  /** Returns the current textual content for a stylesheet. */
  export interface GetStyleSheetTextRequest {
    styleSheetId: DOM.StyleSheetId;
  }
  export interface GetStyleSheetTextResponse {
    text: string;
  }
  /**
   * Resolve the specified values in the context of the provided element.
   * For example, a value of '1em' is evaluated according to the computed
   * 'font-size' of the element and a value 'calc(1px + 2px)' will be
   * resolved to '3px'.
   * If the `propertyName` was specified the `values` are resolved as if
   * they were property's declaration. If a value cannot be parsed according
   * to the provided property syntax, the value is parsed using combined
   * syntax as if null `propertyName` was provided. If the value cannot be
   * resolved even then, return the provided value without any changes.
   * Note: this function currently does not resolve CSS random() function,
   * it returns unmodified random() function parts.`
   * @experimental
   */
  export interface ResolveValuesRequest {
    values: string[];
    nodeId: DOM.NodeId;
    propertyName?: string;
    pseudoType?: DOM.PseudoType;
    pseudoIdentifier?: string;
  }
  export interface ResolveValuesResponse {
    results: string[];
  }
  /**
   * Modifies the expression of a container query.
   * @experimental
   */
  export interface SetContainerQueryTextRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  export interface SetContainerQueryTextResponse {
    containerQuery: CSS.CSSContainerQuery;
  }
  /**
   * Find a rule with the given active property for the given node and set the new value for this
   * property
   */
  export interface SetEffectivePropertyValueForNodeRequest {
    nodeId: DOM.NodeId;
    propertyName: string;
    value: string;
  }
  export interface SetEffectivePropertyValueForNodeResponse {}
  /** Modifies the keyframe rule key text. */
  export interface SetKeyframeKeyRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    keyText: string;
  }
  export interface SetKeyframeKeyResponse {
    keyText: CSS.Value;
  }
  /**
   * Enables/disables rendering of local CSS fonts (enabled by default).
   * @experimental
   */
  export interface SetLocalFontsEnabledRequest {
    enabled: boolean;
  }
  export interface SetLocalFontsEnabledResponse {}
  /** Modifies the rule selector. */
  export interface SetMediaTextRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  export interface SetMediaTextResponse {
    media: CSS.CSSMedia;
  }
  /**
   * Modifies the expression of a navigation at-rule.
   * @experimental
   */
  export interface SetNavigationTextRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  export interface SetNavigationTextResponse {
    navigation: CSS.CSSNavigation;
  }
  /** Modifies the property rule property name. */
  export interface SetPropertyRulePropertyNameRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    propertyName: string;
  }
  export interface SetPropertyRulePropertyNameResponse {
    propertyName: CSS.Value;
  }
  /** Modifies the rule selector. */
  export interface SetRuleSelectorRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    selector: string;
  }
  export interface SetRuleSelectorResponse {
    selectorList: CSS.SelectorList;
  }
  /**
   * Modifies the expression of a scope at-rule.
   * @experimental
   */
  export interface SetScopeTextRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  export interface SetScopeTextResponse {
    scope: CSS.CSSScope;
  }
  /** Sets the new stylesheet text. */
  export interface SetStyleSheetTextRequest {
    styleSheetId: DOM.StyleSheetId;
    text: string;
  }
  export interface SetStyleSheetTextResponse {
    sourceMapURL?: string;
  }
  /** Applies specified style edits one after another in the given order. */
  export interface SetStyleTextsRequest {
    edits: CSS.StyleDeclarationEdit[];
    nodeForPropertySyntaxValidation?: DOM.NodeId;
  }
  export interface SetStyleTextsResponse {
    styles: CSS.CSSStyle[];
  }
  /**
   * Modifies the expression of a supports at-rule.
   * @experimental
   */
  export interface SetSupportsTextRequest {
    styleSheetId: DOM.StyleSheetId;
    range: CSS.SourceRange;
    text: string;
  }
  export interface SetSupportsTextResponse {
    supports: CSS.CSSSupports;
  }
  /** Enables the selector recording. */
  export interface StartRuleUsageTrackingRequest {}
  export interface StartRuleUsageTrackingResponse {}
  /**
   * Stop tracking rule usage and return the list of rules that were used since last call to
   * `takeCoverageDelta` (or since start of coverage instrumentation).
   */
  export interface StopRuleUsageTrackingRequest {}
  export interface StopRuleUsageTrackingResponse {
    ruleUsage: CSS.RuleUsage[];
  }
  /**
   * Polls the next batch of computed style updates.
   * @experimental
   */
  export interface TakeComputedStyleUpdatesRequest {}
  export interface TakeComputedStyleUpdatesResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Obtain list of rules that became used since last call to this method (or since start of coverage
   * instrumentation).
   */
  export interface TakeCoverageDeltaRequest {}
  export interface TakeCoverageDeltaResponse {
    coverage: CSS.RuleUsage[];
    timestamp: number;
  }
  /**
   * Starts tracking the given computed styles for updates. The specified array of properties
   * replaces the one previously specified. Pass empty array to disable tracking.
   * Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
   * The changes to computed style properties are only tracked for nodes pushed to the front-end
   * by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
   * to the front-end, no updates will be issued for the node.
   * @experimental
   */
  export interface TrackComputedStyleUpdatesRequest {
    propertiesToTrack: CSS.CSSComputedStyleProperty[];
  }
  export interface TrackComputedStyleUpdatesResponse {}
  /**
   * Starts tracking the given node for the computed style updates
   * and whenever the computed style is updated for node, it queues
   * a `computedStyleUpdated` event with throttling.
   * There can only be 1 node tracked for computed style updates
   * so passing a new node id removes tracking from the previous node.
   * Pass `undefined` to disable tracking.
   * @experimental
   */
  export interface TrackComputedStyleUpdatesForNodeRequest {
    nodeId?: DOM.NodeId;
  }
  export interface TrackComputedStyleUpdatesForNodeResponse {}
  /** @experimental */
  export interface ComputedStyleUpdatedEvent {
    nodeId: DOM.NodeId;
  }
  /**
   * Fires whenever a web font is updated.  A non-empty font parameter indicates a successfully loaded
   * web font.
   */
  export interface FontsUpdatedEvent {
    font?: CSS.FontFace;
  }
  /**
   * Fires whenever a MediaQuery result changes (for example, after a browser window has been
   * resized.) The current implementation considers only viewport-dependent media features.
   */
  export interface MediaQueryResultChangedEvent {}
  /** Fired whenever an active document stylesheet is added. */
  export interface StyleSheetAddedEvent {
    header: CSS.CSSStyleSheetHeader;
  }
  /** Fired whenever a stylesheet is changed as a result of the client operation. */
  export interface StyleSheetChangedEvent {
    styleSheetId: DOM.StyleSheetId;
  }
  /** Fired whenever an active document stylesheet is removed. */
  export interface StyleSheetRemovedEvent {
    styleSheetId: DOM.StyleSheetId;
  }
}

/**
 * Debugger domain exposes JavaScript debugging capabilities. It allows setting and removing
breakpoints, stepping through execution, exploring stack traces, etc.
 */
export namespace Debugger {
  export interface BreakLocation {
    scriptId: Runtime.ScriptId;
    lineNumber: number;
    columnNumber?: number;
    type?: "debuggerStatement" | "call" | "return";
  }
  /** Breakpoint identifier. */
  export type BreakpointId = string;
  /** JavaScript call frame. Array of call frames form the call stack. */
  export interface CallFrame {
    callFrameId: Debugger.CallFrameId;
    functionName: string;
    functionLocation?: Debugger.Location;
    location: Debugger.Location;
    url: string;
    scopeChain: Debugger.Scope[];
    this: Runtime.RemoteObject;
    returnValue?: Runtime.RemoteObject;
    canBeRestarted?: boolean;
  }
  /** Call frame identifier. */
  export type CallFrameId = string;
  /** Debug symbols available for a wasm script. */
  export interface DebugSymbols {
    type: "SourceMap" | "EmbeddedDWARF" | "ExternalDWARF";
    externalURL?: string;
  }
  /** Location in the source code. */
  export interface Location {
    scriptId: Runtime.ScriptId;
    lineNumber: number;
    columnNumber?: number;
  }
  /**
   * Location range within one script.
   * @experimental
   */
  export interface LocationRange {
    scriptId: Runtime.ScriptId;
    start: Debugger.ScriptPosition;
    end: Debugger.ScriptPosition;
  }
  export interface ResolvedBreakpoint {
    breakpointId: Debugger.BreakpointId;
    location: Debugger.Location;
  }
  /** Scope description. */
  export interface Scope {
    type: "global" | "local" | "with" | "closure" | "catch" | "block" | "script" | "eval" | "module" | "wasm-expression-stack";
    object: Runtime.RemoteObject;
    name?: string;
    startLocation?: Debugger.Location;
    endLocation?: Debugger.Location;
  }
  /** Enum of possible script languages. */
  export type ScriptLanguage = "JavaScript" | "WebAssembly";
  /**
   * Location in the source code.
   * @experimental
   */
  export interface ScriptPosition {
    lineNumber: number;
    columnNumber: number;
  }
  /** Search match for resource. */
  export interface SearchMatch {
    lineNumber: number;
    lineContent: string;
  }
  /** @experimental */
  export interface WasmDisassemblyChunk {
    lines: string[];
    bytecodeOffsets: number[];
  }
  /** Continues execution until specific location is reached. */
  export interface ContinueToLocationRequest {
    location: Debugger.Location;
    targetCallFrames?: "any" | "current";
  }
  export interface ContinueToLocationResponse {}
  /** Disables debugger for given page. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** @experimental */
  export interface DisassembleWasmModuleRequest {
    scriptId: Runtime.ScriptId;
  }
  export interface DisassembleWasmModuleResponse {
    streamId?: string;
    totalNumberOfLines: number;
    functionBodyOffsets: number[];
    chunk: Debugger.WasmDisassemblyChunk;
  }
  /**
   * Enables debugger for the given page. Clients should not assume that the debugging has been
   * enabled until the result for this command is received.
   */
  export interface EnableRequest {
    maxScriptsCacheSize?: number;
  }
  export interface EnableResponse {
    debuggerId: Runtime.UniqueDebuggerId;
  }
  /** Evaluates expression on a given call frame. */
  export interface EvaluateOnCallFrameRequest {
    callFrameId: Debugger.CallFrameId;
    expression: string;
    objectGroup?: string;
    includeCommandLineAPI?: boolean;
    silent?: boolean;
    returnByValue?: boolean;
    generatePreview?: boolean;
    throwOnSideEffect?: boolean;
    timeout?: Runtime.TimeDelta;
  }
  export interface EvaluateOnCallFrameResponse {
    result: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /**
   * Returns possible locations for breakpoint. scriptId in start and end range locations should be
   * the same.
   */
  export interface GetPossibleBreakpointsRequest {
    start: Debugger.Location;
    end?: Debugger.Location;
    restrictToFunction?: boolean;
  }
  export interface GetPossibleBreakpointsResponse {
    locations: Debugger.BreakLocation[];
  }
  /** Returns source for the script with given id. */
  export interface GetScriptSourceRequest {
    scriptId: Runtime.ScriptId;
  }
  export interface GetScriptSourceResponse {
    scriptSource: string;
    bytecode?: string;
  }
  /**
   * Returns stack trace with given `stackTraceId`.
   * @experimental
   */
  export interface GetStackTraceRequest {
    stackTraceId: Runtime.StackTraceId;
  }
  export interface GetStackTraceResponse {
    stackTrace: Runtime.StackTrace;
  }
  /**
   * This command is deprecated. Use getScriptSource instead.
   * @deprecated
   */
  export interface GetWasmBytecodeRequest {
    scriptId: Runtime.ScriptId;
  }
  export interface GetWasmBytecodeResponse {
    bytecode: string;
  }
  /**
   * Disassemble the next chunk of lines for the module corresponding to the
   * stream. If disassembly is complete, this API will invalidate the streamId
   * and return an empty chunk. Any subsequent calls for the now invalid stream
   * will return errors.
   * @experimental
   */
  export interface NextWasmDisassemblyChunkRequest {
    streamId: string;
  }
  export interface NextWasmDisassemblyChunkResponse {
    chunk: Debugger.WasmDisassemblyChunk;
  }
  /** Stops on the next JavaScript statement. */
  export interface PauseRequest {}
  export interface PauseResponse {}
  /**
   * @experimental
   * @deprecated
   */
  export interface PauseOnAsyncCallRequest {
    parentStackTraceId: Runtime.StackTraceId;
  }
  export interface PauseOnAsyncCallResponse {}
  /** Removes JavaScript breakpoint. */
  export interface RemoveBreakpointRequest {
    breakpointId: Debugger.BreakpointId;
  }
  export interface RemoveBreakpointResponse {}
  /**
   * Restarts particular call frame from the beginning. The old, deprecated
   * behavior of `restartFrame` is to stay paused and allow further CDP commands
   * after a restart was scheduled. This can cause problems with restarting, so
   * we now continue execution immediatly after it has been scheduled until we
   * reach the beginning of the restarted frame.
   * 
   * To stay back-wards compatible, `restartFrame` now expects a `mode`
   * parameter to be present. If the `mode` parameter is missing, `restartFrame`
   * errors out.
   * 
   * The various return values are deprecated and `callFrames` is always empty.
   * Use the call frames from the `Debugger#paused` events instead, that fires
   * once V8 pauses at the beginning of the restarted function.
   */
  export interface RestartFrameRequest {
    callFrameId: Debugger.CallFrameId;
    mode?: "StepInto";
  }
  export interface RestartFrameResponse {
    callFrames: Debugger.CallFrame[];
    asyncStackTrace?: Runtime.StackTrace;
    asyncStackTraceId?: Runtime.StackTraceId;
  }
  /** Resumes JavaScript execution. */
  export interface ResumeRequest {
    terminateOnResume?: boolean;
  }
  export interface ResumeResponse {}
  /** Searches for given string in script content. */
  export interface SearchInContentRequest {
    scriptId: Runtime.ScriptId;
    query: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
  }
  export interface SearchInContentResponse {
    result: Debugger.SearchMatch[];
  }
  /** Enables or disables async call stacks tracking. */
  export interface SetAsyncCallStackDepthRequest {
    maxDepth: number;
  }
  export interface SetAsyncCallStackDepthResponse {}
  /**
   * Makes backend skip steps in the script in blackboxed ranges. VM will try leave blacklisted
   * scripts by performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
   * Positions array contains positions where blackbox state is changed. First interval isn't
   * blackboxed. Array should be sorted.
   * @experimental
   */
  export interface SetBlackboxedRangesRequest {
    scriptId: Runtime.ScriptId;
    positions: Debugger.ScriptPosition[];
  }
  export interface SetBlackboxedRangesResponse {}
  /**
   * Replace previous blackbox execution contexts with passed ones. Forces backend to skip
   * stepping/pausing in scripts in these execution contexts. VM will try to leave blackboxed script by
   * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
   * @experimental
   */
  export interface SetBlackboxExecutionContextsRequest {
    uniqueIds: string[];
  }
  export interface SetBlackboxExecutionContextsResponse {}
  /**
   * Replace previous blackbox patterns with passed ones. Forces backend to skip stepping/pausing in
   * scripts with url matching one of the patterns. VM will try to leave blackboxed script by
   * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
   * @experimental
   */
  export interface SetBlackboxPatternsRequest {
    patterns: string[];
    skipAnonymous?: boolean;
  }
  export interface SetBlackboxPatternsResponse {}
  /** Sets JavaScript breakpoint at a given location. */
  export interface SetBreakpointRequest {
    location: Debugger.Location;
    condition?: string;
  }
  export interface SetBreakpointResponse {
    breakpointId: Debugger.BreakpointId;
    actualLocation: Debugger.Location;
  }
  /**
   * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this
   * command is issued, all existing parsed scripts will have breakpoints resolved and returned in
   * `locations` property. Further matching script parsing will result in subsequent
   * `breakpointResolved` events issued. This logical breakpoint will survive page reloads.
   */
  export interface SetBreakpointByUrlRequest {
    lineNumber: number;
    url?: string;
    urlRegex?: string;
    scriptHash?: string;
    columnNumber?: number;
    condition?: string;
  }
  export interface SetBreakpointByUrlResponse {
    breakpointId: Debugger.BreakpointId;
    locations: Debugger.Location[];
  }
  /**
   * Sets JavaScript breakpoint before each call to the given function.
   * If another function was created from the same source as a given one,
   * calling it will also trigger the breakpoint.
   * @experimental
   */
  export interface SetBreakpointOnFunctionCallRequest {
    objectId: Runtime.RemoteObjectId;
    condition?: string;
  }
  export interface SetBreakpointOnFunctionCallResponse {
    breakpointId: Debugger.BreakpointId;
  }
  /** Activates / deactivates all breakpoints on the page. */
  export interface SetBreakpointsActiveRequest {
    active: boolean;
  }
  export interface SetBreakpointsActiveResponse {}
  /** Sets instrumentation breakpoint. */
  export interface SetInstrumentationBreakpointRequest {
    instrumentation: "beforeScriptExecution" | "beforeScriptWithSourceMapExecution";
  }
  export interface SetInstrumentationBreakpointResponse {
    breakpointId: Debugger.BreakpointId;
  }
  /**
   * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions,
   * or caught exceptions, no exceptions. Initial pause on exceptions state is `none`.
   */
  export interface SetPauseOnExceptionsRequest {
    state: "none" | "caught" | "uncaught" | "all";
  }
  export interface SetPauseOnExceptionsResponse {}
  /**
   * Changes return value in top frame. Available only at return break position.
   * @experimental
   */
  export interface SetReturnValueRequest {
    newValue: Runtime.CallArgument;
  }
  export interface SetReturnValueResponse {}
  /**
   * Edits JavaScript source live.
   * 
   * In general, functions that are currently on the stack can not be edited with
   * a single exception: If the edited function is the top-most stack frame and
   * that is the only activation of that function on the stack. In this case
   * the live edit will be successful and a `Debugger.restartFrame` for the
   * top-most function is automatically triggered.
   */
  export interface SetScriptSourceRequest {
    scriptId: Runtime.ScriptId;
    scriptSource: string;
    dryRun?: boolean;
    allowTopFrameEditing?: boolean;
  }
  export interface SetScriptSourceResponse {
    callFrames?: Debugger.CallFrame[];
    stackChanged?: boolean;
    asyncStackTrace?: Runtime.StackTrace;
    asyncStackTraceId?: Runtime.StackTraceId;
    status: "Ok" | "CompileError" | "BlockedByActiveGenerator" | "BlockedByActiveFunction" | "BlockedByTopLevelEsModuleChange";
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /** Makes page not interrupt on any pauses (breakpoint, exception, dom exception etc). */
  export interface SetSkipAllPausesRequest {
    skip: boolean;
  }
  export interface SetSkipAllPausesResponse {}
  /**
   * Changes value of variable in a callframe. Object-based scopes are not supported and must be
   * mutated manually.
   */
  export interface SetVariableValueRequest {
    scopeNumber: number;
    variableName: string;
    newValue: Runtime.CallArgument;
    callFrameId: Debugger.CallFrameId;
  }
  export interface SetVariableValueResponse {}
  /** Steps into the function call. */
  export interface StepIntoRequest {
    breakOnAsyncCall?: boolean;
    skipList?: Debugger.LocationRange[];
  }
  export interface StepIntoResponse {}
  /** Steps out of the function call. */
  export interface StepOutRequest {}
  export interface StepOutResponse {}
  /** Steps over the statement. */
  export interface StepOverRequest {
    skipList?: Debugger.LocationRange[];
  }
  export interface StepOverResponse {}
  /**
   * Fired when breakpoint is resolved to an actual script and location.
   * Deprecated in favor of `resolvedBreakpoints` in the `scriptParsed` event.
   * @deprecated
   */
  export interface BreakpointResolvedEvent {
    breakpointId: Debugger.BreakpointId;
    location: Debugger.Location;
  }
  /** Fired when the virtual machine stopped on breakpoint or exception or any other stop criteria. */
  export interface PausedEvent {
    callFrames: Debugger.CallFrame[];
    reason: "ambiguous" | "assert" | "CSPViolation" | "debugCommand" | "DOM" | "EventListener" | "exception" | "instrumentation" | "OOM" | "other" | "promiseRejection" | "XHR" | "step";
    data?: Record<string, unknown>;
    hitBreakpoints?: string[];
    asyncStackTrace?: Runtime.StackTrace;
    asyncStackTraceId?: Runtime.StackTraceId;
    asyncCallStackTraceId?: Runtime.StackTraceId;
  }
  /** Fired when the virtual machine resumed execution. */
  export interface ResumedEvent {}
  /** Fired when virtual machine fails to parse the script. */
  export interface ScriptFailedToParseEvent {
    scriptId: Runtime.ScriptId;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    executionContextId: Runtime.ExecutionContextId;
    hash: string;
    buildId: string;
    executionContextAuxData?: Record<string, unknown>;
    sourceMapURL?: string;
    hasSourceURL?: boolean;
    isModule?: boolean;
    length?: number;
    stackTrace?: Runtime.StackTrace;
    codeOffset?: number;
    scriptLanguage?: Debugger.ScriptLanguage;
    embedderName?: string;
  }
  /**
   * Fired when virtual machine parses script. This event is also fired for all known and uncollected
   * scripts upon enabling debugger.
   */
  export interface ScriptParsedEvent {
    scriptId: Runtime.ScriptId;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    executionContextId: Runtime.ExecutionContextId;
    hash: string;
    buildId: string;
    executionContextAuxData?: Record<string, unknown>;
    isLiveEdit?: boolean;
    sourceMapURL?: string;
    hasSourceURL?: boolean;
    isModule?: boolean;
    length?: number;
    stackTrace?: Runtime.StackTrace;
    codeOffset?: number;
    scriptLanguage?: Debugger.ScriptLanguage;
    debugSymbols?: Debugger.DebugSymbols[];
    embedderName?: string;
    resolvedBreakpoints?: Debugger.ResolvedBreakpoint[];
  }
}

/**
 * DeviceAccess
 * @experimental
 */
export namespace DeviceAccess {
  /** A device id. */
  export type DeviceId = string;
  /** Device information displayed in a user prompt to select a device. */
  export interface PromptDevice {
    id: DeviceAccess.DeviceId;
    name: string;
  }
  /** Device request id. */
  export type RequestId = string;
  /** Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event. */
  export interface CancelPromptRequest {
    id: DeviceAccess.RequestId;
  }
  export interface CancelPromptResponse {}
  /** Disable events in this domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enable events in this domain. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Select a device in response to a DeviceAccess.deviceRequestPrompted event. */
  export interface SelectPromptRequest {
    id: DeviceAccess.RequestId;
    deviceId: DeviceAccess.DeviceId;
  }
  export interface SelectPromptResponse {}
  /**
   * A device request opened a user prompt to select a device. Respond with the
   * selectPrompt or cancelPrompt command.
   */
  export interface DeviceRequestPromptedEvent {
    id: DeviceAccess.RequestId;
    devices: DeviceAccess.PromptDevice[];
  }
}

/**
 * DeviceOrientation
 * @experimental
 */
export namespace DeviceOrientation {
  /** Clears the overridden Device Orientation. */
  export interface ClearDeviceOrientationOverrideRequest {}
  export interface ClearDeviceOrientationOverrideResponse {}
  /** Overrides the Device Orientation. */
  export interface SetDeviceOrientationOverrideRequest {
    alpha: number;
    beta: number;
    gamma: number;
  }
  export interface SetDeviceOrientationOverrideResponse {}
}

/**
 * This domain exposes DOM read/write operations. Each DOM Node is represented with its mirror object
that has an `id`. This `id` can be used to get additional information on the Node, resolve it into
the JavaScript object wrapper, etc. It is important that client receives DOM events only for the
nodes that are known to the client. Backend keeps track of the nodes that were sent to the client
and never sends the same node twice. It is client's responsibility to collect information about
the nodes that were sent to the client. Note that `iframe` owner elements will return
corresponding document elements as their child nodes.
 */
export namespace DOM {
  /** Backend node with a friendly name. */
  export interface BackendNode {
    nodeType: number;
    nodeName: string;
    backendNodeId: DOM.BackendNodeId;
  }
  /**
   * Unique DOM node identifier used to reference a node that may not have been pushed to the
   * front-end.
   */
  export type BackendNodeId = number;
  /** Box model. */
  export interface BoxModel {
    content: DOM.Quad;
    padding: DOM.Quad;
    border: DOM.Quad;
    margin: DOM.Quad;
    width: number;
    height: number;
    shapeOutside?: DOM.ShapeOutsideInfo;
  }
  /** Document compatibility mode. */
  export type CompatibilityMode = "QuirksMode" | "LimitedQuirksMode" | "NoQuirksMode";
  export interface CSSComputedStyleProperty {
    name: string;
    value: string;
  }
  /** A structure to hold the top-level node of a detached tree and an array of its retained descendants. */
  export interface DetachedElementInfo {
    treeNode: DOM.Node;
    retainedNodeIds: DOM.NodeId[];
  }
  /** ContainerSelector logical axes */
  export type LogicalAxes = "Inline" | "Block" | "Both";
  /**
   * DOM interaction is implemented in terms of mirror objects that represent the actual DOM nodes.
   * DOMNode is a base node mirror type.
   */
  export interface Node {
    nodeId: DOM.NodeId;
    parentId?: DOM.NodeId;
    backendNodeId: DOM.BackendNodeId;
    nodeType: number;
    nodeName: string;
    localName: string;
    nodeValue: string;
    childNodeCount?: number;
    children?: DOM.Node[];
    attributes?: string[];
    documentURL?: string;
    baseURL?: string;
    publicId?: string;
    systemId?: string;
    internalSubset?: string;
    xmlVersion?: string;
    name?: string;
    value?: string;
    pseudoType?: DOM.PseudoType;
    pseudoIdentifier?: string;
    shadowRootType?: DOM.ShadowRootType;
    frameId?: Page.FrameId;
    contentDocument?: DOM.Node;
    shadowRoots?: DOM.Node[];
    templateContent?: DOM.Node;
    pseudoElements?: DOM.Node[];
    importedDocument?: DOM.Node;
    distributedNodes?: DOM.BackendNode[];
    isSVG?: boolean;
    compatibilityMode?: DOM.CompatibilityMode;
    assignedSlot?: DOM.BackendNode;
    isScrollable?: boolean;
    affectedByStartingStyles?: boolean;
    adoptedStyleSheets?: DOM.StyleSheetId[];
    adProvenance?: Network.AdProvenance;
  }
  /** Unique DOM node identifier. */
  export type NodeId = number;
  /** ContainerSelector physical axes */
  export type PhysicalAxes = "Horizontal" | "Vertical" | "Both";
  /** Pseudo element type. */
  export type PseudoType = "first-line" | "first-letter" | "checkmark" | "before" | "after" | "expand-icon" | "picker-icon" | "interest-hint" | "marker" | "backdrop" | "column" | "selection" | "search-text" | "target-text" | "spelling-error" | "grammar-error" | "highlight" | "first-line-inherited" | "scroll-marker" | "scroll-marker-group" | "scroll-button" | "scrollbar" | "scrollbar-thumb" | "scrollbar-button" | "scrollbar-track" | "scrollbar-track-piece" | "scrollbar-corner" | "resizer" | "input-list-button" | "view-transition" | "view-transition-group" | "view-transition-image-pair" | "view-transition-group-children" | "view-transition-old" | "view-transition-new" | "placeholder" | "file-selector-button" | "details-content" | "picker" | "permission-icon" | "overscroll-area-parent";
  /** An array of quad vertices, x immediately followed by y for each point, points clock-wise. */
  export type Quad = number[];
  /** Rectangle. */
  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  /** A structure holding an RGBA color. */
  export interface RGBA {
    r: number;
    g: number;
    b: number;
    a?: number;
  }
  /** Physical scroll orientation */
  export type ScrollOrientation = "horizontal" | "vertical";
  /** Shadow root type. */
  export type ShadowRootType = "user-agent" | "open" | "closed";
  /** CSS Shape Outside details. */
  export interface ShapeOutsideInfo {
    bounds: DOM.Quad;
    shape: unknown[];
    marginShape: unknown[];
  }
  /** Unique identifier for a CSS stylesheet. */
  export type StyleSheetId = string;
  /**
   * Collects class names for the node with given id and all of it's child nodes.
   * @experimental
   */
  export interface CollectClassNamesFromSubtreeRequest {
    nodeId: DOM.NodeId;
  }
  export interface CollectClassNamesFromSubtreeResponse {
    classNames: string[];
  }
  /**
   * Creates a deep copy of the specified node and places it into the target container before the
   * given anchor.
   * @experimental
   */
  export interface CopyToRequest {
    nodeId: DOM.NodeId;
    targetNodeId: DOM.NodeId;
    insertBeforeNodeId?: DOM.NodeId;
  }
  export interface CopyToResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Describes node given its id, does not require domain to be enabled. Does not start tracking any
   * objects, can be used for automation.
   */
  export interface DescribeNodeRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    depth?: number;
    pierce?: boolean;
  }
  export interface DescribeNodeResponse {
    node: DOM.Node;
  }
  /** Disables DOM agent for the given page. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Discards search results from the session with the given id. `getSearchResults` should no longer
   * be called for that search.
   * @experimental
   */
  export interface DiscardSearchResultsRequest {
    searchId: string;
  }
  export interface DiscardSearchResultsResponse {}
  /** Enables DOM agent for the given page. */
  export interface EnableRequest {
    includeWhitespace?: "none" | "all";
  }
  export interface EnableResponse {}
  /** Focuses the given element. */
  export interface FocusRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface FocusResponse {}
  /**
   * When enabling, this API force-opens the popover identified by nodeId
   * and keeps it open until disabled.
   * @experimental
   */
  export interface ForceShowPopoverRequest {
    nodeId: DOM.NodeId;
    enable: boolean;
  }
  export interface ForceShowPopoverResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Returns the target anchor element of the given anchor query according to
   * https://www.w3.org/TR/css-anchor-position-1/#target.
   * @experimental
   */
  export interface GetAnchorElementRequest {
    nodeId: DOM.NodeId;
    anchorSpecifier?: string;
  }
  export interface GetAnchorElementResponse {
    nodeId: DOM.NodeId;
  }
  /** Returns attributes for the specified node. */
  export interface GetAttributesRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetAttributesResponse {
    attributes: string[];
  }
  /** Returns boxes for the given node. */
  export interface GetBoxModelRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface GetBoxModelResponse {
    model: DOM.BoxModel;
  }
  /**
   * Returns the query container of the given node based on container query
   * conditions: containerName, physical and logical axes, and whether it queries
   * scroll-state or anchored elements. If no axes are provided and
   * queriesScrollState is false, the style container is returned, which is the
   * direct parent or the closest element with a matching container-name.
   * @experimental
   */
  export interface GetContainerForNodeRequest {
    nodeId: DOM.NodeId;
    containerName?: string;
    physicalAxes?: DOM.PhysicalAxes;
    logicalAxes?: DOM.LogicalAxes;
    queriesScrollState?: boolean;
    queriesAnchored?: boolean;
  }
  export interface GetContainerForNodeResponse {
    nodeId?: DOM.NodeId;
  }
  /**
   * Returns quads that describe node position on the page. This method
   * might return multiple quads for inline nodes.
   * @experimental
   */
  export interface GetContentQuadsRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface GetContentQuadsResponse {
    quads: DOM.Quad[];
  }
  /**
   * Returns list of detached nodes
   * @experimental
   */
  export interface GetDetachedDomNodesRequest {}
  export interface GetDetachedDomNodesResponse {
    detachedNodes: DOM.DetachedElementInfo[];
  }
  /**
   * Returns the root DOM node (and optionally the subtree) to the caller.
   * Implicitly enables the DOM domain events for the current target.
   */
  export interface GetDocumentRequest {
    depth?: number;
    pierce?: boolean;
  }
  export interface GetDocumentResponse {
    root: DOM.Node;
  }
  /**
   * Returns the NodeId of the matched element according to certain relations.
   * @experimental
   */
  export interface GetElementByRelationRequest {
    nodeId: DOM.NodeId;
    relation: "PopoverTarget" | "InterestTarget" | "CommandFor";
  }
  export interface GetElementByRelationResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Returns file information for the given
   * File wrapper.
   * @experimental
   */
  export interface GetFileInfoRequest {
    objectId: Runtime.RemoteObjectId;
  }
  export interface GetFileInfoResponse {
    path: string;
  }
  /**
   * Returns the root DOM node (and optionally the subtree) to the caller.
   * Deprecated, as it is not designed to work well with the rest of the DOM agent.
   * Use DOMSnapshot.captureSnapshot instead.
   * @deprecated
   */
  export interface GetFlattenedDocumentRequest {
    depth?: number;
    pierce?: boolean;
  }
  export interface GetFlattenedDocumentResponse {
    nodes: DOM.Node[];
  }
  /**
   * Returns iframe node that owns iframe with the given domain.
   * @experimental
   */
  export interface GetFrameOwnerRequest {
    frameId: Page.FrameId;
  }
  export interface GetFrameOwnerResponse {
    backendNodeId: DOM.BackendNodeId;
    nodeId?: DOM.NodeId;
  }
  /**
   * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
   * either returned or not.
   */
  export interface GetNodeForLocationRequest {
    x: number;
    y: number;
    includeUserAgentShadowDOM?: boolean;
    ignorePointerEventsNone?: boolean;
  }
  export interface GetNodeForLocationResponse {
    backendNodeId: DOM.BackendNodeId;
    frameId: Page.FrameId;
    nodeId?: DOM.NodeId;
  }
  /**
   * Finds nodes with a given computed style in a subtree.
   * @experimental
   */
  export interface GetNodesForSubtreeByStyleRequest {
    nodeId: DOM.NodeId;
    computedStyles: DOM.CSSComputedStyleProperty[];
    pierce?: boolean;
  }
  export interface GetNodesForSubtreeByStyleResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
   * @experimental
   */
  export interface GetNodeStackTracesRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetNodeStackTracesResponse {
    creation?: Runtime.StackTrace;
  }
  /** Returns node's HTML markup. */
  export interface GetOuterHTMLRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    includeShadowDOM?: boolean;
  }
  export interface GetOuterHTMLResponse {
    outerHTML: string;
  }
  /**
   * Returns the descendants of a container query container that have
   * container queries against this container.
   * @experimental
   */
  export interface GetQueryingDescendantsForContainerRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetQueryingDescendantsForContainerResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Returns the id of the nearest ancestor that is a relayout boundary.
   * @experimental
   */
  export interface GetRelayoutBoundaryRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetRelayoutBoundaryResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
   * identifier.
   * @experimental
   */
  export interface GetSearchResultsRequest {
    searchId: string;
    fromIndex: number;
    toIndex: number;
  }
  export interface GetSearchResultsResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Returns NodeIds of current top layer elements.
   * Top layer is rendered closest to the user within a viewport, therefore its elements always
   * appear on top of all other content.
   * @experimental
   */
  export interface GetTopLayerElementsRequest {}
  export interface GetTopLayerElementsResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Marks last undoable state.
   * @experimental
   */
  export interface MarkUndoableStateRequest {}
  export interface MarkUndoableStateResponse {}
  /** Moves node into the new container, places it before the given anchor. */
  export interface MoveToRequest {
    nodeId: DOM.NodeId;
    targetNodeId: DOM.NodeId;
    insertBeforeNodeId?: DOM.NodeId;
  }
  export interface MoveToResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
   * `cancelSearch` to end this search session.
   * @experimental
   */
  export interface PerformSearchRequest {
    query: string;
    includeUserAgentShadowDOM?: boolean;
  }
  export interface PerformSearchResponse {
    searchId: string;
    resultCount: number;
  }
  /**
   * Requests that the node is sent to the caller given its path. // FIXME, use XPath
   * @experimental
   */
  export interface PushNodeByPathToFrontendRequest {
    path: string;
  }
  export interface PushNodeByPathToFrontendResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Requests that a batch of nodes is sent to the caller given their backend node ids.
   * @experimental
   */
  export interface PushNodesByBackendIdsToFrontendRequest {
    backendNodeIds: DOM.BackendNodeId[];
  }
  export interface PushNodesByBackendIdsToFrontendResponse {
    nodeIds: DOM.NodeId[];
  }
  /** Executes `querySelector` on a given node. */
  export interface QuerySelectorRequest {
    nodeId: DOM.NodeId;
    selector: string;
  }
  export interface QuerySelectorResponse {
    nodeId: DOM.NodeId;
  }
  /** Executes `querySelectorAll` on a given node. */
  export interface QuerySelectorAllRequest {
    nodeId: DOM.NodeId;
    selector: string;
  }
  export interface QuerySelectorAllResponse {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Re-does the last undone action.
   * @experimental
   */
  export interface RedoRequest {}
  export interface RedoResponse {}
  /** Removes attribute with given name from an element with given id. */
  export interface RemoveAttributeRequest {
    nodeId: DOM.NodeId;
    name: string;
  }
  export interface RemoveAttributeResponse {}
  /** Removes node with given id. */
  export interface RemoveNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface RemoveNodeResponse {}
  /**
   * Requests that children of the node with given id are returned to the caller in form of
   * `setChildNodes` events where not only immediate children are retrieved, but all children down to
   * the specified depth.
   */
  export interface RequestChildNodesRequest {
    nodeId: DOM.NodeId;
    depth?: number;
    pierce?: boolean;
  }
  export interface RequestChildNodesResponse {}
  /**
   * Requests that the node is sent to the caller given the JavaScript node object reference. All
   * nodes that form the path from the node to the root are also sent to the client as a series of
   * `setChildNodes` notifications.
   */
  export interface RequestNodeRequest {
    objectId: Runtime.RemoteObjectId;
  }
  export interface RequestNodeResponse {
    nodeId: DOM.NodeId;
  }
  /** Resolves the JavaScript node object for a given NodeId or BackendNodeId. */
  export interface ResolveNodeRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectGroup?: string;
    executionContextId?: Runtime.ExecutionContextId;
  }
  export interface ResolveNodeResponse {
    object: Runtime.RemoteObject;
  }
  /**
   * Scrolls the specified rect of the given node into view if not already visible.
   * Note: exactly one between nodeId, backendNodeId and objectId should be passed
   * to identify the node.
   */
  export interface ScrollIntoViewIfNeededRequest {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    rect?: DOM.Rect;
  }
  export interface ScrollIntoViewIfNeededResponse {}
  /**
   * Sets attributes on element with given id. This method is useful when user edits some existing
   * attribute value and types in several attribute name/value pairs.
   */
  export interface SetAttributesAsTextRequest {
    nodeId: DOM.NodeId;
    text: string;
    name?: string;
  }
  export interface SetAttributesAsTextResponse {}
  /** Sets attribute for an element with given id. */
  export interface SetAttributeValueRequest {
    nodeId: DOM.NodeId;
    name: string;
    value: string;
  }
  export interface SetAttributeValueResponse {}
  /** Sets files for the given file input element. */
  export interface SetFileInputFilesRequest {
    files: string[];
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface SetFileInputFilesResponse {}
  /**
   * Enables console to refer to the node with given id via $x (see Command Line API for more details
   * $x functions).
   * @experimental
   */
  export interface SetInspectedNodeRequest {
    nodeId: DOM.NodeId;
  }
  export interface SetInspectedNodeResponse {}
  /** Sets node name for a node with given id. */
  export interface SetNodeNameRequest {
    nodeId: DOM.NodeId;
    name: string;
  }
  export interface SetNodeNameResponse {
    nodeId: DOM.NodeId;
  }
  /**
   * Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.
   * @experimental
   */
  export interface SetNodeStackTracesEnabledRequest {
    enable: boolean;
  }
  export interface SetNodeStackTracesEnabledResponse {}
  /** Sets node value for a node with given id. */
  export interface SetNodeValueRequest {
    nodeId: DOM.NodeId;
    value: string;
  }
  export interface SetNodeValueResponse {}
  /** Sets node HTML markup, returns new node id. */
  export interface SetOuterHTMLRequest {
    nodeId: DOM.NodeId;
    outerHTML: string;
  }
  export interface SetOuterHTMLResponse {}
  /**
   * Undoes the last performed action.
   * @experimental
   */
  export interface UndoRequest {}
  export interface UndoResponse {}
  /**
   * Fired when `Element`'s adoptedStyleSheets are modified.
   * @experimental
   */
  export interface AdoptedStyleSheetsModifiedEvent {
    nodeId: DOM.NodeId;
    adoptedStyleSheets: DOM.StyleSheetId[];
  }
  /**
   * Fired when a node's ad related state changes.
   * @experimental
   */
  export interface AdRelatedStateUpdatedEvent {
    nodeId: DOM.NodeId;
    adProvenance?: Network.AdProvenance;
  }
  /**
   * Fired when a node's starting styles changes.
   * @experimental
   */
  export interface AffectedByStartingStylesFlagUpdatedEvent {
    nodeId: DOM.NodeId;
    affectedByStartingStyles: boolean;
  }
  /** Fired when `Element`'s attribute is modified. */
  export interface AttributeModifiedEvent {
    nodeId: DOM.NodeId;
    name: string;
    value: string;
  }
  /** Fired when `Element`'s attribute is removed. */
  export interface AttributeRemovedEvent {
    nodeId: DOM.NodeId;
    name: string;
  }
  /** Mirrors `DOMCharacterDataModified` event. */
  export interface CharacterDataModifiedEvent {
    nodeId: DOM.NodeId;
    characterData: string;
  }
  /** Fired when `Container`'s child node count has changed. */
  export interface ChildNodeCountUpdatedEvent {
    nodeId: DOM.NodeId;
    childNodeCount: number;
  }
  /** Mirrors `DOMNodeInserted` event. */
  export interface ChildNodeInsertedEvent {
    parentNodeId: DOM.NodeId;
    previousNodeId: DOM.NodeId;
    node: DOM.Node;
  }
  /** Mirrors `DOMNodeRemoved` event. */
  export interface ChildNodeRemovedEvent {
    parentNodeId: DOM.NodeId;
    nodeId: DOM.NodeId;
  }
  /**
   * Called when distribution is changed.
   * @experimental
   */
  export interface DistributedNodesUpdatedEvent {
    insertionPointId: DOM.NodeId;
    distributedNodes: DOM.BackendNode[];
  }
  /** Fired when `Document` has been totally updated. Node ids are no longer valid. */
  export interface DocumentUpdatedEvent {}
  /**
   * Fired when `Element`'s inline style is modified via a CSS property modification.
   * @experimental
   */
  export interface InlineStyleInvalidatedEvent {
    nodeIds: DOM.NodeId[];
  }
  /**
   * Called when a pseudo element is added to an element.
   * @experimental
   */
  export interface PseudoElementAddedEvent {
    parentId: DOM.NodeId;
    pseudoElement: DOM.Node;
  }
  /**
   * Called when a pseudo element is removed from an element.
   * @experimental
   */
  export interface PseudoElementRemovedEvent {
    parentId: DOM.NodeId;
    pseudoElementId: DOM.NodeId;
  }
  /**
   * Fired when a node's scrollability state changes.
   * @experimental
   */
  export interface ScrollableFlagUpdatedEvent {
    nodeId: DOM.NodeId;
    isScrollable: boolean;
  }
  /**
   * Fired when backend wants to provide client with the missing DOM structure. This happens upon
   * most of the calls requesting node ids.
   */
  export interface SetChildNodesEvent {
    parentId: DOM.NodeId;
    nodes: DOM.Node[];
  }
  /**
   * Called when shadow root is popped from the element.
   * @experimental
   */
  export interface ShadowRootPoppedEvent {
    hostId: DOM.NodeId;
    rootId: DOM.NodeId;
  }
  /**
   * Called when shadow root is pushed into the element.
   * @experimental
   */
  export interface ShadowRootPushedEvent {
    hostId: DOM.NodeId;
    root: DOM.Node;
  }
  /**
   * Called when top layer elements are changed.
   * @experimental
   */
  export interface TopLayerElementsUpdatedEvent {}
}

/**
 * DOM debugging allows setting breakpoints on particular DOM operations and events. JavaScript
execution will stop on these operations as if there was a regular breakpoint set.
 */
export namespace DOMDebugger {
  /**
   * CSP Violation type.
   * @experimental
   */
  export type CSPViolationType = "trustedtype-sink-violation" | "trustedtype-policy-violation";
  /** DOM breakpoint type. */
  export type DOMBreakpointType = "subtree-modified" | "attribute-modified" | "node-removed";
  /** Object event listener. */
  export interface EventListener {
    type: string;
    useCapture: boolean;
    passive: boolean;
    once: boolean;
    scriptId: Runtime.ScriptId;
    lineNumber: number;
    columnNumber: number;
    handler?: Runtime.RemoteObject;
    originalHandler?: Runtime.RemoteObject;
    backendNodeId?: DOM.BackendNodeId;
  }
  /** Returns event listeners of the given object. */
  export interface GetEventListenersRequest {
    objectId: Runtime.RemoteObjectId;
    depth?: number;
    pierce?: boolean;
  }
  export interface GetEventListenersResponse {
    listeners: DOMDebugger.EventListener[];
  }
  /** Removes DOM breakpoint that was set using `setDOMBreakpoint`. */
  export interface RemoveDOMBreakpointRequest {
    nodeId: DOM.NodeId;
    type: DOMDebugger.DOMBreakpointType;
  }
  export interface RemoveDOMBreakpointResponse {}
  /** Removes breakpoint on particular DOM event. */
  export interface RemoveEventListenerBreakpointRequest {
    eventName: string;
    targetName?: string;
  }
  export interface RemoveEventListenerBreakpointResponse {}
  /** Removes breakpoint from XMLHttpRequest. */
  export interface RemoveXHRBreakpointRequest {
    url: string;
  }
  export interface RemoveXHRBreakpointResponse {}
  /**
   * Sets breakpoint on particular CSP violations.
   * @experimental
   */
  export interface SetBreakOnCSPViolationRequest {
    violationTypes: DOMDebugger.CSPViolationType[];
  }
  export interface SetBreakOnCSPViolationResponse {}
  /** Sets breakpoint on particular operation with DOM. */
  export interface SetDOMBreakpointRequest {
    nodeId: DOM.NodeId;
    type: DOMDebugger.DOMBreakpointType;
  }
  export interface SetDOMBreakpointResponse {}
  /** Sets breakpoint on particular DOM event. */
  export interface SetEventListenerBreakpointRequest {
    eventName: string;
    targetName?: string;
  }
  export interface SetEventListenerBreakpointResponse {}
  /** Sets breakpoint on XMLHttpRequest. */
  export interface SetXHRBreakpointRequest {
    url: string;
  }
  export interface SetXHRBreakpointResponse {}
}

/**
 * This domain facilitates obtaining document snapshots with DOM, layout, and style information.
 * @experimental
 */
export namespace DOMSnapshot {
  /** Index of the string in the strings table. */
  export type ArrayOfStrings = DOMSnapshot.StringIndex[];
  /** A subset of the full ComputedStyle as defined by the request whitelist. */
  export interface ComputedStyle {
    properties: DOMSnapshot.NameValue[];
  }
  /** Document snapshot. */
  export interface DocumentSnapshot {
    documentURL: DOMSnapshot.StringIndex;
    title: DOMSnapshot.StringIndex;
    baseURL: DOMSnapshot.StringIndex;
    contentLanguage: DOMSnapshot.StringIndex;
    encodingName: DOMSnapshot.StringIndex;
    publicId: DOMSnapshot.StringIndex;
    systemId: DOMSnapshot.StringIndex;
    frameId: DOMSnapshot.StringIndex;
    nodes: DOMSnapshot.NodeTreeSnapshot;
    layout: DOMSnapshot.LayoutTreeSnapshot;
    textBoxes: DOMSnapshot.TextBoxSnapshot;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
    contentWidth?: number;
    contentHeight?: number;
  }
  /** A Node in the DOM tree. */
  export interface DOMNode {
    nodeType: number;
    nodeName: string;
    nodeValue: string;
    textValue?: string;
    inputValue?: string;
    inputChecked?: boolean;
    optionSelected?: boolean;
    backendNodeId: DOM.BackendNodeId;
    childNodeIndexes?: number[];
    attributes?: DOMSnapshot.NameValue[];
    pseudoElementIndexes?: number[];
    layoutNodeIndex?: number;
    documentURL?: string;
    baseURL?: string;
    contentLanguage?: string;
    documentEncoding?: string;
    publicId?: string;
    systemId?: string;
    frameId?: Page.FrameId;
    contentDocumentIndex?: number;
    pseudoType?: DOM.PseudoType;
    shadowRootType?: DOM.ShadowRootType;
    isClickable?: boolean;
    eventListeners?: DOMDebugger.EventListener[];
    currentSourceURL?: string;
    originURL?: string;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
  }
  /**
   * Details of post layout rendered text positions. The exact layout should not be regarded as
   * stable and may change between versions.
   */
  export interface InlineTextBox {
    boundingBox: DOM.Rect;
    startCharacterIndex: number;
    numCharacters: number;
  }
  /** Details of an element in the DOM tree with a LayoutObject. */
  export interface LayoutTreeNode {
    domNodeIndex: number;
    boundingBox: DOM.Rect;
    layoutText?: string;
    inlineTextNodes?: DOMSnapshot.InlineTextBox[];
    styleIndex?: number;
    paintOrder?: number;
    isStackingContext?: boolean;
  }
  /** Table of details of an element in the DOM tree with a LayoutObject. */
  export interface LayoutTreeSnapshot {
    nodeIndex: number[];
    styles: DOMSnapshot.ArrayOfStrings[];
    bounds: DOMSnapshot.Rectangle[];
    text: DOMSnapshot.StringIndex[];
    stackingContexts: DOMSnapshot.RareBooleanData;
    paintOrders?: number[];
    offsetRects?: DOMSnapshot.Rectangle[];
    scrollRects?: DOMSnapshot.Rectangle[];
    clientRects?: DOMSnapshot.Rectangle[];
    blendedBackgroundColors?: DOMSnapshot.StringIndex[];
    textColorOpacities?: number[];
  }
  /** A name/value pair. */
  export interface NameValue {
    name: string;
    value: string;
  }
  /** Table containing nodes. */
  export interface NodeTreeSnapshot {
    parentIndex?: number[];
    nodeType?: number[];
    shadowRootType?: DOMSnapshot.RareStringData;
    nodeName?: DOMSnapshot.StringIndex[];
    nodeValue?: DOMSnapshot.StringIndex[];
    backendNodeId?: DOM.BackendNodeId[];
    attributes?: DOMSnapshot.ArrayOfStrings[];
    textValue?: DOMSnapshot.RareStringData;
    inputValue?: DOMSnapshot.RareStringData;
    inputChecked?: DOMSnapshot.RareBooleanData;
    optionSelected?: DOMSnapshot.RareBooleanData;
    contentDocumentIndex?: DOMSnapshot.RareIntegerData;
    pseudoType?: DOMSnapshot.RareStringData;
    pseudoIdentifier?: DOMSnapshot.RareStringData;
    isClickable?: DOMSnapshot.RareBooleanData;
    currentSourceURL?: DOMSnapshot.RareStringData;
    originURL?: DOMSnapshot.RareStringData;
  }
  export interface RareBooleanData {
    index: number[];
  }
  export interface RareIntegerData {
    index: number[];
    value: number[];
  }
  /** Data that is only present on rare nodes. */
  export interface RareStringData {
    index: number[];
    value: DOMSnapshot.StringIndex[];
  }
  export type Rectangle = number[];
  /** Index of the string in the strings table. */
  export type StringIndex = number;
  /**
   * Table of details of the post layout rendered text positions. The exact layout should not be regarded as
   * stable and may change between versions.
   */
  export interface TextBoxSnapshot {
    layoutIndex: number[];
    bounds: DOMSnapshot.Rectangle[];
    start: number[];
    length: number[];
  }
  /**
   * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
   * template contents, and imported documents) in a flattened array, as well as layout and
   * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
   * flattened.
   */
  export interface CaptureSnapshotRequest {
    computedStyles: string[];
    includePaintOrder?: boolean;
    includeDOMRects?: boolean;
    includeBlendedBackgroundColors?: boolean;
    includeTextColorOpacities?: boolean;
  }
  export interface CaptureSnapshotResponse {
    documents: DOMSnapshot.DocumentSnapshot[];
    strings: string[];
  }
  /** Disables DOM snapshot agent for the given page. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables DOM snapshot agent for the given page. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
   * template contents, and imported documents) in a flattened array, as well as layout and
   * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
   * flattened.
   * @deprecated
   */
  export interface GetSnapshotRequest {
    computedStyleWhitelist: string[];
    includeEventListeners?: boolean;
    includePaintOrder?: boolean;
    includeUserAgentShadowTree?: boolean;
  }
  export interface GetSnapshotResponse {
    domNodes: DOMSnapshot.DOMNode[];
    layoutTreeNodes: DOMSnapshot.LayoutTreeNode[];
    computedStyles: DOMSnapshot.ComputedStyle[];
  }
}

/**
 * Query and modify DOM storage.
 * @experimental
 */
export namespace DOMStorage {
  /** DOM Storage item. */
  export type Item = string[];
  export type SerializedStorageKey = string;
  /** DOM Storage identifier. */
  export interface StorageId {
    securityOrigin?: string;
    storageKey?: DOMStorage.SerializedStorageKey;
    isLocalStorage: boolean;
  }
  export interface ClearRequest {
    storageId: DOMStorage.StorageId;
  }
  export interface ClearResponse {}
  /** Disables storage tracking, prevents storage events from being sent to the client. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables storage tracking, storage events will now be delivered to the client. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  export interface GetDOMStorageItemsRequest {
    storageId: DOMStorage.StorageId;
  }
  export interface GetDOMStorageItemsResponse {
    entries: DOMStorage.Item[];
  }
  export interface RemoveDOMStorageItemRequest {
    storageId: DOMStorage.StorageId;
    key: string;
  }
  export interface RemoveDOMStorageItemResponse {}
  export interface SetDOMStorageItemRequest {
    storageId: DOMStorage.StorageId;
    key: string;
    value: string;
  }
  export interface SetDOMStorageItemResponse {}
  export interface DomStorageItemAddedEvent {
    storageId: DOMStorage.StorageId;
    key: string;
    newValue: string;
  }
  export interface DomStorageItemRemovedEvent {
    storageId: DOMStorage.StorageId;
    key: string;
  }
  export interface DomStorageItemsClearedEvent {
    storageId: DOMStorage.StorageId;
  }
  export interface DomStorageItemUpdatedEvent {
    storageId: DOMStorage.StorageId;
    key: string;
    oldValue: string;
    newValue: string;
  }
}

/**
 * This domain emulates different environments for the page.
 */
export namespace Emulation {
  export interface DevicePosture {
    type: "continuous" | "folded";
  }
  /**
   * Enum of image types that can be disabled.
   * @experimental
   */
  export type DisabledImageType = "avif" | "jxl" | "webp";
  export interface DisplayFeature {
    orientation: "vertical" | "horizontal";
    offset: number;
    maskLength: number;
  }
  export interface MediaFeature {
    name: string;
    value: string;
  }
  /** @experimental */
  export interface PressureMetadata {
    available?: boolean;
  }
  /** @experimental */
  export type PressureSource = "cpu";
  /** @experimental */
  export type PressureState = "nominal" | "fair" | "serious" | "critical";
  /** @experimental */
  export interface SafeAreaInsets {
    top?: number;
    topMax?: number;
    left?: number;
    leftMax?: number;
    bottom?: number;
    bottomMax?: number;
    right?: number;
    rightMax?: number;
  }
  /** @experimental */
  export type ScreenId = string;
  /**
   * Screen information similar to the one returned by window.getScreenDetails() method,
   * see https://w3c.github.io/window-management/#screendetailed.
   * @experimental
   */
  export interface ScreenInfo {
    left: number;
    top: number;
    width: number;
    height: number;
    availLeft: number;
    availTop: number;
    availWidth: number;
    availHeight: number;
    devicePixelRatio: number;
    orientation: Emulation.ScreenOrientation;
    colorDepth: number;
    isExtended: boolean;
    isInternal: boolean;
    isPrimary: boolean;
    label: string;
    id: Emulation.ScreenId;
  }
  /** Screen orientation. */
  export interface ScreenOrientation {
    type: "portraitPrimary" | "portraitSecondary" | "landscapePrimary" | "landscapeSecondary";
    angle: number;
  }
  /** @experimental */
  export interface SensorMetadata {
    available?: boolean;
    minimumFrequency?: number;
    maximumFrequency?: number;
  }
  /** @experimental */
  export interface SensorReading {
    single?: Emulation.SensorReadingSingle;
    xyz?: Emulation.SensorReadingXYZ;
    quaternion?: Emulation.SensorReadingQuaternion;
  }
  /** @experimental */
  export interface SensorReadingQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
  }
  /** @experimental */
  export interface SensorReadingSingle {
    value: number;
  }
  /** @experimental */
  export interface SensorReadingXYZ {
    x: number;
    y: number;
    z: number;
  }
  /**
   * Used to specify sensor types to emulate.
   * See https://w3c.github.io/sensors/#automation for more information.
   * @experimental
   */
  export type SensorType = "absolute-orientation" | "accelerometer" | "ambient-light" | "gravity" | "gyroscope" | "linear-acceleration" | "magnetometer" | "relative-orientation";
  /**
   * Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints
   * @experimental
   */
  export interface UserAgentBrandVersion {
    brand: string;
    version: string;
  }
  /**
   * Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints
   * Missing optional values will be filled in by the target with what it would normally use.
   * @experimental
   */
  export interface UserAgentMetadata {
    brands?: Emulation.UserAgentBrandVersion[];
    fullVersionList?: Emulation.UserAgentBrandVersion[];
    fullVersion?: string;
    platform: string;
    platformVersion: string;
    architecture: string;
    model: string;
    mobile: boolean;
    bitness?: string;
    wow64?: boolean;
    formFactors?: string[];
  }
  /**
   * advance: If the scheduler runs out of immediate work, the virtual time base may fast forward to
   * allow the next delayed task (if any) to run; pause: The virtual time base may not advance;
   * pauseIfNetworkFetchesPending: The virtual time base may not advance if there are any pending
   * resource fetches.
   * @experimental
   */
  export type VirtualTimePolicy = "advance" | "pause" | "pauseIfNetworkFetchesPending";
  /** @experimental */
  export interface WorkAreaInsets {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
  }
  /**
   * Add a new screen to the device. Only supported in headless mode.
   * @experimental
   */
  export interface AddScreenRequest {
    left: number;
    top: number;
    width: number;
    height: number;
    workAreaInsets?: Emulation.WorkAreaInsets;
    devicePixelRatio?: number;
    rotation?: number;
    colorDepth?: number;
    label?: string;
    isInternal?: boolean;
  }
  export interface AddScreenResponse {
    screenInfo: Emulation.ScreenInfo;
  }
  /**
   * Tells whether emulation is supported.
   * @deprecated
   */
  export interface CanEmulateRequest {}
  export interface CanEmulateResponse {
    result: boolean;
  }
  /** Clears the overridden device metrics. */
  export interface ClearDeviceMetricsOverrideRequest {}
  export interface ClearDeviceMetricsOverrideResponse {}
  /**
   * Clears a device posture override set with either setDeviceMetricsOverride()
   * or setDevicePostureOverride() and starts using posture information from the
   * platform again.
   * Does nothing if no override is set.
   * @experimental
   */
  export interface ClearDevicePostureOverrideRequest {}
  export interface ClearDevicePostureOverrideResponse {}
  /**
   * Clears the display features override set with either setDeviceMetricsOverride()
   * or setDisplayFeaturesOverride() and starts using display features from the
   * platform again.
   * Does nothing if no override is set.
   * @experimental
   */
  export interface ClearDisplayFeaturesOverrideRequest {}
  export interface ClearDisplayFeaturesOverrideResponse {}
  /** Clears the overridden Geolocation Position and Error. */
  export interface ClearGeolocationOverrideRequest {}
  export interface ClearGeolocationOverrideResponse {}
  /** Clears Idle state overrides. */
  export interface ClearIdleOverrideRequest {}
  export interface ClearIdleOverrideResponse {}
  /** @experimental */
  export interface GetOverriddenSensorInformationRequest {
    type: Emulation.SensorType;
  }
  export interface GetOverriddenSensorInformationResponse {
    requestedSamplingFrequency: number;
  }
  /**
   * Returns device's screen configuration. In headful mode, the physical screens configuration is returned,
   * whereas in headless mode, a virtual headless screen configuration is provided instead.
   * @experimental
   */
  export interface GetScreenInfosRequest {}
  export interface GetScreenInfosResponse {
    screenInfos: Emulation.ScreenInfo[];
  }
  /**
   * Remove screen from the device. Only supported in headless mode.
   * @experimental
   */
  export interface RemoveScreenRequest {
    screenId: Emulation.ScreenId;
  }
  export interface RemoveScreenResponse {}
  /**
   * Requests that page scale factor is reset to initial values.
   * @experimental
   */
  export interface ResetPageScaleFactorRequest {}
  export interface ResetPageScaleFactorResponse {}
  /**
   * Automatically render all web contents using a dark theme.
   * @experimental
   */
  export interface SetAutoDarkModeOverrideRequest {
    enabled?: boolean;
  }
  export interface SetAutoDarkModeOverrideResponse {}
  /**
   * Allows overriding the automation flag.
   * @experimental
   */
  export interface SetAutomationOverrideRequest {
    enabled: boolean;
  }
  export interface SetAutomationOverrideResponse {}
  /** Enables CPU throttling to emulate slow CPUs. */
  export interface SetCPUThrottlingRateRequest {
    rate: number;
  }
  export interface SetCPUThrottlingRateResponse {}
  /**
   * Override the value of navigator.connection.saveData
   * @experimental
   */
  export interface SetDataSaverOverrideRequest {
    dataSaverEnabled?: boolean;
  }
  export interface SetDataSaverOverrideResponse {}
  /**
   * Sets or clears an override of the default background color of the frame. This override is used
   * if the content does not specify one.
   */
  export interface SetDefaultBackgroundColorOverrideRequest {
    color?: DOM.RGBA;
  }
  export interface SetDefaultBackgroundColorOverrideResponse {}
  /**
   * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
   * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
   * query results).
   */
  export interface SetDeviceMetricsOverrideRequest {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
    scale?: number;
    screenWidth?: number;
    screenHeight?: number;
    positionX?: number;
    positionY?: number;
    dontSetVisibleSize?: boolean;
    screenOrientation?: Emulation.ScreenOrientation;
    viewport?: Page.Viewport;
    displayFeature?: Emulation.DisplayFeature;
    devicePosture?: Emulation.DevicePosture;
    scrollbarType?: "overlay" | "default";
    screenOrientationLockEmulation?: boolean;
  }
  export interface SetDeviceMetricsOverrideResponse {}
  /**
   * Start reporting the given posture value to the Device Posture API.
   * This override can also be set in setDeviceMetricsOverride().
   * @experimental
   */
  export interface SetDevicePostureOverrideRequest {
    posture: Emulation.DevicePosture;
  }
  export interface SetDevicePostureOverrideResponse {}
  /** @experimental */
  export interface SetDisabledImageTypesRequest {
    imageTypes: Emulation.DisabledImageType[];
  }
  export interface SetDisabledImageTypesResponse {}
  /**
   * Start using the given display features to pupulate the Viewport Segments API.
   * This override can also be set in setDeviceMetricsOverride().
   * @experimental
   */
  export interface SetDisplayFeaturesOverrideRequest {
    features: Emulation.DisplayFeature[];
  }
  export interface SetDisplayFeaturesOverrideResponse {}
  /** @experimental */
  export interface SetDocumentCookieDisabledRequest {
    disabled: boolean;
  }
  export interface SetDocumentCookieDisabledResponse {}
  /** @experimental */
  export interface SetEmitTouchEventsForMouseRequest {
    enabled: boolean;
    configuration?: "mobile" | "desktop";
  }
  export interface SetEmitTouchEventsForMouseResponse {}
  /** Emulates the given media type or media feature for CSS media queries. */
  export interface SetEmulatedMediaRequest {
    media?: string;
    features?: Emulation.MediaFeature[];
  }
  export interface SetEmulatedMediaResponse {}
  /** Emulates the given OS text scale. */
  export interface SetEmulatedOSTextScaleRequest {
    scale?: number;
  }
  export interface SetEmulatedOSTextScaleResponse {}
  /** Emulates the given vision deficiency. */
  export interface SetEmulatedVisionDeficiencyRequest {
    type: "none" | "blurredVision" | "reducedContrast" | "achromatopsia" | "deuteranopia" | "protanopia" | "tritanopia";
  }
  export interface SetEmulatedVisionDeficiencyResponse {}
  /**
   * Enables or disables simulating a focused and active page.
   * @experimental
   */
  export interface SetFocusEmulationEnabledRequest {
    enabled: boolean;
  }
  export interface SetFocusEmulationEnabledResponse {}
  /**
   * Overrides the Geolocation Position or Error. Omitting latitude, longitude or
   * accuracy emulates position unavailable.
   */
  export interface SetGeolocationOverrideRequest {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    altitude?: number;
    altitudeAccuracy?: number;
    heading?: number;
    speed?: number;
  }
  export interface SetGeolocationOverrideResponse {}
  /** @experimental */
  export interface SetHardwareConcurrencyOverrideRequest {
    hardwareConcurrency: number;
  }
  export interface SetHardwareConcurrencyOverrideResponse {}
  /** Overrides the Idle state. */
  export interface SetIdleOverrideRequest {
    isUserActive: boolean;
    isScreenUnlocked: boolean;
  }
  export interface SetIdleOverrideResponse {}
  /**
   * Overrides default host system locale with the specified one.
   * @experimental
   */
  export interface SetLocaleOverrideRequest {
    locale?: string;
  }
  export interface SetLocaleOverrideResponse {}
  /**
   * Overrides value returned by the javascript navigator object.
   * @experimental
   * @deprecated
   */
  export interface SetNavigatorOverridesRequest {
    platform: string;
  }
  export interface SetNavigatorOverridesResponse {}
  /**
   * Sets a specified page scale factor.
   * @experimental
   */
  export interface SetPageScaleFactorRequest {
    pageScaleFactor: number;
  }
  export interface SetPageScaleFactorResponse {}
  /**
   * Provides a given pressure data set that will be processed and eventually be
   * delivered to PressureObserver users. |source| must have been previously
   * overridden by setPressureSourceOverrideEnabled.
   * @experimental
   */
  export interface SetPressureDataOverrideRequest {
    source: Emulation.PressureSource;
    state: Emulation.PressureState;
    ownContributionEstimate?: number;
  }
  export interface SetPressureDataOverrideResponse {}
  /**
   * Overrides a pressure source of a given type, as used by the Compute
   * Pressure API, so that updates to PressureObserver.observe() are provided
   * via setPressureStateOverride instead of being retrieved from
   * platform-provided telemetry data.
   * @experimental
   */
  export interface SetPressureSourceOverrideEnabledRequest {
    enabled: boolean;
    source: Emulation.PressureSource;
    metadata?: Emulation.PressureMetadata;
  }
  export interface SetPressureSourceOverrideEnabledResponse {}
  /**
   * TODO: OBSOLETE: To remove when setPressureDataOverride is merged.
   * Provides a given pressure state that will be processed and eventually be
   * delivered to PressureObserver users. |source| must have been previously
   * overridden by setPressureSourceOverrideEnabled.
   * @experimental
   */
  export interface SetPressureStateOverrideRequest {
    source: Emulation.PressureSource;
    state: Emulation.PressureState;
  }
  export interface SetPressureStateOverrideResponse {}
  /**
   * Set primary screen. Only supported in headless mode.
   * Note that this changes the coordinate system origin to the top-left
   * of the new primary screen, updating the bounds and work areas
   * of all existing screens accordingly.
   * @experimental
   */
  export interface SetPrimaryScreenRequest {
    screenId: Emulation.ScreenId;
  }
  export interface SetPrimaryScreenResponse {}
  /**
   * Overrides the values for env(safe-area-inset-*) and env(safe-area-max-inset-*). Unset values will cause the
   * respective variables to be undefined, even if previously overridden.
   * @experimental
   */
  export interface SetSafeAreaInsetsOverrideRequest {
    insets: Emulation.SafeAreaInsets;
  }
  export interface SetSafeAreaInsetsOverrideResponse {}
  /** Switches script execution in the page. */
  export interface SetScriptExecutionDisabledRequest {
    value: boolean;
  }
  export interface SetScriptExecutionDisabledResponse {}
  /** @experimental */
  export interface SetScrollbarsHiddenRequest {
    hidden: boolean;
  }
  export interface SetScrollbarsHiddenResponse {}
  /**
   * Overrides a platform sensor of a given type. If |enabled| is true, calls to
   * Sensor.start() will use a virtual sensor as backend rather than fetching
   * data from a real hardware sensor. Otherwise, existing virtual
   * sensor-backend Sensor objects will fire an error event and new calls to
   * Sensor.start() will attempt to use a real sensor instead.
   * @experimental
   */
  export interface SetSensorOverrideEnabledRequest {
    enabled: boolean;
    type: Emulation.SensorType;
    metadata?: Emulation.SensorMetadata;
  }
  export interface SetSensorOverrideEnabledResponse {}
  /**
   * Updates the sensor readings reported by a sensor type previously overridden
   * by setSensorOverrideEnabled.
   * @experimental
   */
  export interface SetSensorOverrideReadingsRequest {
    type: Emulation.SensorType;
    reading: Emulation.SensorReading;
  }
  export interface SetSensorOverrideReadingsResponse {}
  /**
   * Allows overriding the difference between the small and large viewport sizes, which determine the
   * value of the `svh` and `lvh` unit, respectively. Only supported for top-level frames.
   * @experimental
   */
  export interface SetSmallViewportHeightDifferenceOverrideRequest {
    difference: number;
  }
  export interface SetSmallViewportHeightDifferenceOverrideResponse {}
  /** Overrides default host system timezone with the specified one. */
  export interface SetTimezoneOverrideRequest {
    timezoneId: string;
  }
  export interface SetTimezoneOverrideResponse {}
  /** Enables touch on platforms which do not support them. */
  export interface SetTouchEmulationEnabledRequest {
    enabled: boolean;
    maxTouchPoints?: number;
  }
  export interface SetTouchEmulationEnabledResponse {}
  /**
   * Allows overriding user agent with the given string.
   * `userAgentMetadata` must be set for Client Hint headers to be sent.
   */
  export interface SetUserAgentOverrideRequest {
    userAgent: string;
    acceptLanguage?: string;
    platform?: string;
    userAgentMetadata?: Emulation.UserAgentMetadata;
  }
  export interface SetUserAgentOverrideResponse {}
  /**
   * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
   * the current virtual time policy.  Note this supersedes any previous time budget.
   * @experimental
   */
  export interface SetVirtualTimePolicyRequest {
    policy: Emulation.VirtualTimePolicy;
    budget?: number;
    maxVirtualTimeTaskStarvationCount?: number;
    initialVirtualTime?: Network.TimeSinceEpoch;
  }
  export interface SetVirtualTimePolicyResponse {
    virtualTimeTicksBase: number;
  }
  /**
   * Resizes the frame/viewport of the page. Note that this does not affect the frame's container
   * (e.g. browser window). Can be used to produce screenshots of the specified size. Not supported
   * on Android.
   * @experimental
   * @deprecated
   */
  export interface SetVisibleSizeRequest {
    width: number;
    height: number;
  }
  export interface SetVisibleSizeResponse {}
  /**
   * Updates specified screen parameters. Only supported in headless mode.
   * @experimental
   */
  export interface UpdateScreenRequest {
    screenId: Emulation.ScreenId;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    workAreaInsets?: Emulation.WorkAreaInsets;
    devicePixelRatio?: number;
    rotation?: number;
    colorDepth?: number;
    label?: string;
    isInternal?: boolean;
  }
  export interface UpdateScreenResponse {
    screenInfo: Emulation.ScreenInfo;
  }
  /**
   * Fired when a page calls screen.orientation.lock() or screen.orientation.unlock()
   * while device emulation is enabled. This allows the DevTools frontend to update the
   * emulated device orientation accordingly.
   * @experimental
   */
  export interface ScreenOrientationLockChangedEvent {
    locked: boolean;
    orientation?: Emulation.ScreenOrientation;
  }
  /**
   * Notification sent after the virtual time budget for the current VirtualTimePolicy has run out.
   * @experimental
   */
  export interface VirtualTimeBudgetExpiredEvent {}
}

/**
 * EventBreakpoints permits setting JavaScript breakpoints on operations and events
occurring in native code invoked from JavaScript. Once breakpoint is hit, it is
reported through Debugger domain, similarly to regular breakpoints being hit.
 * @experimental
 */
export namespace EventBreakpoints {
  /** Removes all breakpoints */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Removes breakpoint on particular native event. */
  export interface RemoveInstrumentationBreakpointRequest {
    eventName: string;
  }
  export interface RemoveInstrumentationBreakpointResponse {}
  /** Sets breakpoint on particular native event. */
  export interface SetInstrumentationBreakpointRequest {
    eventName: string;
  }
  export interface SetInstrumentationBreakpointResponse {}
}

/**
 * Defines commands and events for browser extensions.
 * @experimental
 */
export namespace Extensions {
  /** Detailed information about an extension. */
  export interface ExtensionInfo {
    id: string;
    name: string;
    version: string;
    path: string;
    enabled: boolean;
  }
  /** Storage areas. */
  export type StorageArea = "session" | "local" | "sync" | "managed";
  /** Clears extension storage in the given `storageArea`. */
  export interface ClearStorageItemsRequest {
    id: string;
    storageArea: Extensions.StorageArea;
  }
  export interface ClearStorageItemsResponse {}
  /** Gets a list of all unpacked extensions. */
  export interface GetExtensionsRequest {}
  export interface GetExtensionsResponse {
    extensions: Extensions.ExtensionInfo[];
  }
  /**
   * Gets data from extension storage in the given `storageArea`. If `keys` is
   * specified, these are used to filter the result.
   */
  export interface GetStorageItemsRequest {
    id: string;
    storageArea: Extensions.StorageArea;
    keys?: string[];
  }
  export interface GetStorageItemsResponse {
    data: Record<string, unknown>;
  }
  /**
   * Installs an unpacked extension from the filesystem similar to
   * --load-extension CLI flags. Returns extension ID once the extension
   * has been installed.
   */
  export interface LoadUnpackedRequest {
    path: string;
    enableInIncognito?: boolean;
  }
  export interface LoadUnpackedResponse {
    id: string;
  }
  /** Removes `keys` from extension storage in the given `storageArea`. */
  export interface RemoveStorageItemsRequest {
    id: string;
    storageArea: Extensions.StorageArea;
    keys: string[];
  }
  export interface RemoveStorageItemsResponse {}
  /**
   * Sets `values` in extension storage in the given `storageArea`. The provided `values`
   * will be merged with existing values in the storage area.
   */
  export interface SetStorageItemsRequest {
    id: string;
    storageArea: Extensions.StorageArea;
    values: Record<string, unknown>;
  }
  export interface SetStorageItemsResponse {}
  /** Runs an extension default action. */
  export interface TriggerActionRequest {
    id: string;
    targetId: string;
  }
  export interface TriggerActionResponse {}
  /** Uninstalls an unpacked extension (others not supported) from the profile. */
  export interface UninstallRequest {
    id: string;
  }
  export interface UninstallResponse {}
}

/**
 * This domain allows interacting with the FedCM dialog.
 * @experimental
 */
export namespace FedCm {
  /** Corresponds to IdentityRequestAccount */
  export interface Account {
    accountId: string;
    email: string;
    name: string;
    givenName: string;
    pictureUrl: string;
    idpConfigUrl: string;
    idpLoginUrl: string;
    loginState: FedCm.LoginState;
    termsOfServiceUrl?: string;
    privacyPolicyUrl?: string;
  }
  /** The URLs that each account has */
  export type AccountUrlType = "TermsOfService" | "PrivacyPolicy";
  /** The buttons on the FedCM dialog. */
  export type DialogButton = "ConfirmIdpLoginContinue" | "ErrorGotIt" | "ErrorMoreDetails";
  /** The types of FedCM dialogs. */
  export type DialogType = "AccountChooser" | "AutoReauthn" | "ConfirmIdpLogin" | "Error";
  /**
   * Whether this is a sign-up or sign-in action for this account, i.e.
   * whether this account has ever been used to sign in to this RP before.
   */
  export type LoginState = "SignIn" | "SignUp";
  export interface ClickDialogButtonRequest {
    dialogId: string;
    dialogButton: FedCm.DialogButton;
  }
  export interface ClickDialogButtonResponse {}
  export interface DisableRequest {}
  export interface DisableResponse {}
  export interface DismissDialogRequest {
    dialogId: string;
    triggerCooldown?: boolean;
  }
  export interface DismissDialogResponse {}
  export interface EnableRequest {
    disableRejectionDelay?: boolean;
  }
  export interface EnableResponse {}
  export interface OpenUrlRequest {
    dialogId: string;
    accountIndex: number;
    accountUrlType: FedCm.AccountUrlType;
  }
  export interface OpenUrlResponse {}
  /**
   * Resets the cooldown time, if any, to allow the next FedCM call to show
   * a dialog even if one was recently dismissed by the user.
   */
  export interface ResetCooldownRequest {}
  export interface ResetCooldownResponse {}
  export interface SelectAccountRequest {
    dialogId: string;
    accountIndex: number;
  }
  export interface SelectAccountResponse {}
  /**
   * Triggered when a dialog is closed, either by user action, JS abort,
   * or a command below.
   */
  export interface DialogClosedEvent {
    dialogId: string;
  }
  export interface DialogShownEvent {
    dialogId: string;
    dialogType: FedCm.DialogType;
    accounts: FedCm.Account[];
    title: string;
    subtitle?: string;
  }
}

/**
 * A domain for letting clients substitute browser's network layer with client code.
 */
export namespace Fetch {
  /** Authorization challenge for HTTP status code 401 or 407. */
  export interface AuthChallenge {
    source?: "Server" | "Proxy";
    origin: string;
    scheme: string;
    realm: string;
  }
  /** Response to an AuthChallenge. */
  export interface AuthChallengeResponse {
    response: "Default" | "CancelAuth" | "ProvideCredentials";
    username?: string;
    password?: string;
  }
  /** Response HTTP header entry */
  export interface HeaderEntry {
    name: string;
    value: string;
  }
  /**
   * Unique request identifier.
   * Note that this does not identify individual HTTP requests that are part of
   * a network request.
   */
  export type RequestId = string;
  export interface RequestPattern {
    urlPattern?: string;
    resourceType?: Network.ResourceType;
    requestStage?: Fetch.RequestStage;
  }
  /**
   * Stages of the request to handle. Request will intercept before the request is
   * sent. Response will intercept after the response is received (but before response
   * body is received).
   */
  export type RequestStage = "Request" | "Response";
  /** Continues the request, optionally modifying some of its parameters. */
  export interface ContinueRequestRequest {
    requestId: Fetch.RequestId;
    url?: string;
    method?: string;
    postData?: string;
    headers?: Fetch.HeaderEntry[];
    interceptResponse?: boolean;
  }
  export interface ContinueRequestResponse {}
  /**
   * Continues loading of the paused response, optionally modifying the
   * response headers. If either responseCode or headers are modified, all of them
   * must be present.
   * @experimental
   */
  export interface ContinueResponseRequest {
    requestId: Fetch.RequestId;
    responseCode?: number;
    responsePhrase?: string;
    responseHeaders?: Fetch.HeaderEntry[];
    binaryResponseHeaders?: string;
  }
  export interface ContinueResponseResponse {}
  /** Continues a request supplying authChallengeResponse following authRequired event. */
  export interface ContinueWithAuthRequest {
    requestId: Fetch.RequestId;
    authChallengeResponse: Fetch.AuthChallengeResponse;
  }
  export interface ContinueWithAuthResponse {}
  /** Disables the fetch domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables issuing of requestPaused events. A request will be paused until client
   * calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.
   */
  export interface EnableRequest {
    patterns?: Fetch.RequestPattern[];
    handleAuthRequests?: boolean;
  }
  export interface EnableResponse {}
  /** Causes the request to fail with specified reason. */
  export interface FailRequestRequest {
    requestId: Fetch.RequestId;
    errorReason: Network.ErrorReason;
  }
  export interface FailRequestResponse {}
  /** Provides response to the request. */
  export interface FulfillRequestRequest {
    requestId: Fetch.RequestId;
    responseCode: number;
    responseHeaders?: Fetch.HeaderEntry[];
    binaryResponseHeaders?: string;
    body?: string;
    responsePhrase?: string;
  }
  export interface FulfillRequestResponse {}
  /**
   * Causes the body of the response to be received from the server and
   * returned as a single string. May only be issued for a request that
   * is paused in the Response stage and is mutually exclusive with
   * takeResponseBodyForInterceptionAsStream. Calling other methods that
   * affect the request or disabling fetch domain before body is received
   * results in an undefined behavior.
   * Note that the response body is not available for redirects. Requests
   * paused in the _redirect received_ state may be differentiated by
   * `responseCode` and presence of `location` response header, see
   * comments to `requestPaused` for details.
   */
  export interface GetResponseBodyRequest {
    requestId: Fetch.RequestId;
  }
  export interface GetResponseBodyResponse {
    body: string;
    base64Encoded: boolean;
  }
  /**
   * Returns a handle to the stream representing the response body.
   * The request must be paused in the HeadersReceived stage.
   * Note that after this command the request can't be continued
   * as is -- client either needs to cancel it or to provide the
   * response body.
   * The stream only supports sequential read, IO.read will fail if the position
   * is specified.
   * This method is mutually exclusive with getResponseBody.
   * Calling other methods that affect the request or disabling fetch
   * domain before body is received results in an undefined behavior.
   */
  export interface TakeResponseBodyAsStreamRequest {
    requestId: Fetch.RequestId;
  }
  export interface TakeResponseBodyAsStreamResponse {
    stream: IO.StreamHandle;
  }
  /**
   * Issued when the domain is enabled with handleAuthRequests set to true.
   * The request is paused until client responds with continueWithAuth.
   */
  export interface AuthRequiredEvent {
    requestId: Fetch.RequestId;
    request: Network.Request;
    frameId: Page.FrameId;
    resourceType: Network.ResourceType;
    authChallenge: Fetch.AuthChallenge;
  }
  /**
   * Issued when the domain is enabled and the request URL matches the
   * specified filter. The request is paused until the client responds
   * with one of continueRequest, failRequest or fulfillRequest.
   * The stage of the request can be determined by presence of responseErrorReason
   * and responseStatusCode -- the request is at the response stage if either
   * of these fields is present and in the request stage otherwise.
   * Redirect responses and subsequent requests are reported similarly to regular
   * responses and requests. Redirect responses may be distinguished by the value
   * of `responseStatusCode` (which is one of 301, 302, 303, 307, 308) along with
   * presence of the `location` header. Requests resulting from a redirect will
   * have `redirectedRequestId` field set.
   */
  export interface RequestPausedEvent {
    requestId: Fetch.RequestId;
    request: Network.Request;
    frameId: Page.FrameId;
    resourceType: Network.ResourceType;
    responseErrorReason?: Network.ErrorReason;
    responseStatusCode?: number;
    responseStatusText?: string;
    responseHeaders?: Fetch.HeaderEntry[];
    networkId?: Network.RequestId;
    redirectedRequestId?: Fetch.RequestId;
  }
}

/**
 * FileSystem
 * @experimental
 */
export namespace FileSystem {
  export interface BucketFileSystemLocator {
    storageKey: Storage.SerializedStorageKey;
    bucketName?: string;
    pathComponents: string[];
  }
  export interface Directory {
    name: string;
    nestedDirectories: string[];
    nestedFiles: FileSystem.File[];
  }
  export interface File {
    name: string;
    lastModified: Network.TimeSinceEpoch;
    size: number;
    type: string;
  }
  export interface GetDirectoryRequest {
    bucketFileSystemLocator: FileSystem.BucketFileSystemLocator;
  }
  export interface GetDirectoryResponse {
    directory: FileSystem.Directory;
  }
}

/**
 * This domain provides experimental commands only supported in headless mode.
 * @experimental
 */
export namespace HeadlessExperimental {
  /** Encoding options for a screenshot. */
  export interface ScreenshotParams {
    format?: "jpeg" | "png" | "webp";
    quality?: number;
    optimizeForSpeed?: boolean;
  }
  /**
   * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
   * screenshot from the resulting frame. Requires that the target was created with enabled
   * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
   * https://goo.gle/chrome-headless-rendering for more background.
   */
  export interface BeginFrameRequest {
    frameTimeTicks?: number;
    interval?: number;
    noDisplayUpdates?: boolean;
    screenshot?: HeadlessExperimental.ScreenshotParams;
  }
  export interface BeginFrameResponse {
    hasDamage: boolean;
    screenshotData?: string;
  }
  /**
   * Disables headless events for the target.
   * @deprecated
   */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables headless events for the target.
   * @deprecated
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
}

/**
 * HeapProfiler
 * @experimental
 */
export namespace HeapProfiler {
  /** Heap snapshot object id. */
  export type HeapSnapshotObjectId = string;
  /** Sampling profile. */
  export interface SamplingHeapProfile {
    head: HeapProfiler.SamplingHeapProfileNode;
    samples: HeapProfiler.SamplingHeapProfileSample[];
  }
  /** Sampling Heap Profile node. Holds callsite information, allocation statistics and child nodes. */
  export interface SamplingHeapProfileNode {
    callFrame: Runtime.CallFrame;
    selfSize: number;
    id: number;
    children: HeapProfiler.SamplingHeapProfileNode[];
  }
  /** A single sample from a sampling profile. */
  export interface SamplingHeapProfileSample {
    size: number;
    nodeId: number;
    ordinal: number;
  }
  /**
   * Enables console to refer to the node with given id via $x (see Command Line API for more details
   * $x functions).
   */
  export interface AddInspectedHeapObjectRequest {
    heapObjectId: HeapProfiler.HeapSnapshotObjectId;
  }
  export interface AddInspectedHeapObjectResponse {}
  export interface CollectGarbageRequest {}
  export interface CollectGarbageResponse {}
  export interface DisableRequest {}
  export interface DisableResponse {}
  export interface EnableRequest {}
  export interface EnableResponse {}
  export interface GetHeapObjectIdRequest {
    objectId: Runtime.RemoteObjectId;
  }
  export interface GetHeapObjectIdResponse {
    heapSnapshotObjectId: HeapProfiler.HeapSnapshotObjectId;
  }
  export interface GetObjectByHeapObjectIdRequest {
    objectId: HeapProfiler.HeapSnapshotObjectId;
    objectGroup?: string;
  }
  export interface GetObjectByHeapObjectIdResponse {
    result: Runtime.RemoteObject;
  }
  export interface GetSamplingProfileRequest {}
  export interface GetSamplingProfileResponse {
    profile: HeapProfiler.SamplingHeapProfile;
  }
  export interface StartSamplingRequest {
    samplingInterval?: number;
    stackDepth?: number;
    includeObjectsCollectedByMajorGC?: boolean;
    includeObjectsCollectedByMinorGC?: boolean;
  }
  export interface StartSamplingResponse {}
  export interface StartTrackingHeapObjectsRequest {
    trackAllocations?: boolean;
  }
  export interface StartTrackingHeapObjectsResponse {}
  export interface StopSamplingRequest {}
  export interface StopSamplingResponse {
    profile: HeapProfiler.SamplingHeapProfile;
  }
  export interface StopTrackingHeapObjectsRequest {
    reportProgress?: boolean;
    treatGlobalObjectsAsRoots?: boolean;
    captureNumericValue?: boolean;
    exposeInternals?: boolean;
  }
  export interface StopTrackingHeapObjectsResponse {}
  export interface TakeHeapSnapshotRequest {
    reportProgress?: boolean;
    treatGlobalObjectsAsRoots?: boolean;
    captureNumericValue?: boolean;
    exposeInternals?: boolean;
  }
  export interface TakeHeapSnapshotResponse {}
  export interface AddHeapSnapshotChunkEvent {
    chunk: string;
  }
  /** If heap objects tracking has been started then backend may send update for one or more fragments */
  export interface HeapStatsUpdateEvent {
    statsUpdate: number[];
  }
  /**
   * If heap objects tracking has been started then backend regularly sends a current value for last
   * seen object id and corresponding timestamp. If the were changes in the heap since last event
   * then one or more heapStatsUpdate events will be sent before a new lastSeenObjectId event.
   */
  export interface LastSeenObjectIdEvent {
    lastSeenObjectId: number;
    timestamp: number;
  }
  export interface ReportHeapSnapshotProgressEvent {
    done: number;
    total: number;
    finished?: boolean;
  }
  export interface ResetProfilesEvent {}
}

/**
 * IndexedDB
 * @experimental
 */
export namespace IndexedDB {
  /** Database with an array of object stores. */
  export interface DatabaseWithObjectStores {
    name: string;
    version: number;
    objectStores: IndexedDB.ObjectStore[];
  }
  /** Data entry. */
  export interface DataEntry {
    key: Runtime.RemoteObject;
    primaryKey: Runtime.RemoteObject;
    value: Runtime.RemoteObject;
  }
  /** Key. */
  export interface Key {
    type: "number" | "string" | "date" | "array";
    number?: number;
    string?: string;
    date?: number;
    array?: IndexedDB.Key[];
  }
  /** Key path. */
  export interface KeyPath {
    type: "null" | "string" | "array";
    string?: string;
    array?: string[];
  }
  /** Key range. */
  export interface KeyRange {
    lower?: IndexedDB.Key;
    upper?: IndexedDB.Key;
    lowerOpen: boolean;
    upperOpen: boolean;
  }
  /** Object store. */
  export interface ObjectStore {
    name: string;
    keyPath: IndexedDB.KeyPath;
    autoIncrement: boolean;
    indexes: IndexedDB.ObjectStoreIndex[];
  }
  /** Object store index. */
  export interface ObjectStoreIndex {
    name: string;
    keyPath: IndexedDB.KeyPath;
    unique: boolean;
    multiEntry: boolean;
  }
  /** Clears all entries from an object store. */
  export interface ClearObjectStoreRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
    objectStoreName: string;
  }
  export interface ClearObjectStoreResponse {}
  /** Deletes a database. */
  export interface DeleteDatabaseRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
  }
  export interface DeleteDatabaseResponse {}
  /** Delete a range of entries from an object store */
  export interface DeleteObjectStoreEntriesRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
    objectStoreName: string;
    keyRange: IndexedDB.KeyRange;
  }
  export interface DeleteObjectStoreEntriesResponse {}
  /** Disables events from backend. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables events from backend. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Gets metadata of an object store. */
  export interface GetMetadataRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
    objectStoreName: string;
  }
  export interface GetMetadataResponse {
    entriesCount: number;
    keyGeneratorValue: number;
  }
  /** Requests data from object store or index. */
  export interface RequestDataRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
    objectStoreName: string;
    indexName?: string;
    skipCount: number;
    pageSize: number;
    keyRange?: IndexedDB.KeyRange;
  }
  export interface RequestDataResponse {
    objectStoreDataEntries: IndexedDB.DataEntry[];
    hasMore: boolean;
  }
  /** Requests database with given name in given frame. */
  export interface RequestDatabaseRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
    databaseName: string;
  }
  export interface RequestDatabaseResponse {
    databaseWithObjectStores: IndexedDB.DatabaseWithObjectStores;
  }
  /** Requests database names for given security origin. */
  export interface RequestDatabaseNamesRequest {
    securityOrigin?: string;
    storageKey?: string;
    storageBucket?: Storage.StorageBucket;
  }
  export interface RequestDatabaseNamesResponse {
    databaseNames: string[];
  }
}

export namespace Input {
  /** @experimental */
  export interface DragData {
    items: Input.DragDataItem[];
    files?: string[];
    dragOperationsMask: number;
  }
  /** @experimental */
  export interface DragDataItem {
    mimeType: string;
    data: string;
    title?: string;
    baseURL?: string;
  }
  /** @experimental */
  export type GestureSourceType = "default" | "touch" | "mouse";
  export type MouseButton = "none" | "left" | "middle" | "right" | "back" | "forward";
  /** UTC time in seconds, counted from January 1, 1970. */
  export type TimeSinceEpoch = number;
  export interface TouchPoint {
    x: number;
    y: number;
    radiusX?: number;
    radiusY?: number;
    rotationAngle?: number;
    force?: number;
    tangentialPressure?: number;
    tiltX?: number;
    tiltY?: number;
    twist?: number;
    id?: number;
  }
  /** Cancels any active dragging in the page. */
  export interface CancelDraggingRequest {}
  export interface CancelDraggingResponse {}
  /**
   * Dispatches a drag event into the page.
   * @experimental
   */
  export interface DispatchDragEventRequest {
    type: "dragEnter" | "dragOver" | "drop" | "dragCancel";
    x: number;
    y: number;
    data: Input.DragData;
    modifiers?: number;
  }
  export interface DispatchDragEventResponse {}
  /** Dispatches a key event to the page. */
  export interface DispatchKeyEventRequest {
    type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
    modifiers?: number;
    timestamp?: Input.TimeSinceEpoch;
    text?: string;
    unmodifiedText?: string;
    keyIdentifier?: string;
    code?: string;
    key?: string;
    windowsVirtualKeyCode?: number;
    nativeVirtualKeyCode?: number;
    autoRepeat?: boolean;
    isKeypad?: boolean;
    isSystemKey?: boolean;
    location?: number;
    commands?: string[];
  }
  export interface DispatchKeyEventResponse {}
  /** Dispatches a mouse event to the page. */
  export interface DispatchMouseEventRequest {
    type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
    x: number;
    y: number;
    modifiers?: number;
    timestamp?: Input.TimeSinceEpoch;
    button?: Input.MouseButton;
    buttons?: number;
    clickCount?: number;
    force?: number;
    tangentialPressure?: number;
    tiltX?: number;
    tiltY?: number;
    twist?: number;
    deltaX?: number;
    deltaY?: number;
    pointerType?: "mouse" | "pen";
  }
  export interface DispatchMouseEventResponse {}
  /** Dispatches a touch event to the page. */
  export interface DispatchTouchEventRequest {
    type: "touchStart" | "touchEnd" | "touchMove" | "touchCancel";
    touchPoints: Input.TouchPoint[];
    modifiers?: number;
    timestamp?: Input.TimeSinceEpoch;
  }
  export interface DispatchTouchEventResponse {}
  /**
   * Emulates touch event from the mouse event parameters.
   * @experimental
   */
  export interface EmulateTouchFromMouseEventRequest {
    type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
    x: number;
    y: number;
    button: Input.MouseButton;
    timestamp?: Input.TimeSinceEpoch;
    deltaX?: number;
    deltaY?: number;
    modifiers?: number;
    clickCount?: number;
  }
  export interface EmulateTouchFromMouseEventResponse {}
  /**
   * This method sets the current candidate text for IME.
   * Use imeCommitComposition to commit the final text.
   * Use imeSetComposition with empty string as text to cancel composition.
   * @experimental
   */
  export interface ImeSetCompositionRequest {
    text: string;
    selectionStart: number;
    selectionEnd: number;
    replacementStart?: number;
    replacementEnd?: number;
  }
  export interface ImeSetCompositionResponse {}
  /**
   * This method emulates inserting text that doesn't come from a key press,
   * for example an emoji keyboard or an IME.
   * @experimental
   */
  export interface InsertTextRequest {
    text: string;
  }
  export interface InsertTextResponse {}
  /** Ignores input events (useful while auditing page). */
  export interface SetIgnoreInputEventsRequest {
    ignore: boolean;
  }
  export interface SetIgnoreInputEventsResponse {}
  /**
   * Prevents default drag and drop behavior and instead emits `Input.dragIntercepted` events.
   * Drag and drop behavior can be directly controlled via `Input.dispatchDragEvent`.
   * @experimental
   */
  export interface SetInterceptDragsRequest {
    enabled: boolean;
  }
  export interface SetInterceptDragsResponse {}
  /**
   * Synthesizes a pinch gesture over a time period by issuing appropriate touch events.
   * @experimental
   */
  export interface SynthesizePinchGestureRequest {
    x: number;
    y: number;
    scaleFactor: number;
    relativeSpeed?: number;
    gestureSourceType?: Input.GestureSourceType;
  }
  export interface SynthesizePinchGestureResponse {}
  /**
   * Synthesizes a scroll gesture over a time period by issuing appropriate touch events.
   * @experimental
   */
  export interface SynthesizeScrollGestureRequest {
    x: number;
    y: number;
    xDistance?: number;
    yDistance?: number;
    xOverscroll?: number;
    yOverscroll?: number;
    preventFling?: boolean;
    speed?: number;
    gestureSourceType?: Input.GestureSourceType;
    repeatCount?: number;
    repeatDelayMs?: number;
    interactionMarkerName?: string;
  }
  export interface SynthesizeScrollGestureResponse {}
  /**
   * Synthesizes a tap gesture over a time period by issuing appropriate touch events.
   * @experimental
   */
  export interface SynthesizeTapGestureRequest {
    x: number;
    y: number;
    duration?: number;
    tapCount?: number;
    gestureSourceType?: Input.GestureSourceType;
  }
  export interface SynthesizeTapGestureResponse {}
  /**
   * Emitted only when `Input.setInterceptDrags` is enabled. Use this data with `Input.dispatchDragEvent` to
   * restore normal drag and drop behavior.
   * @experimental
   */
  export interface DragInterceptedEvent {
    data: Input.DragData;
  }
}

/**
 * Inspector
 * @experimental
 */
export namespace Inspector {
  /** Disables inspector domain notifications. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables inspector domain notifications. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Fired when remote debugging connection is about to be terminated. Contains detach reason. */
  export interface DetachedEvent {
    reason: string;
  }
  /** Fired when debugging target has crashed */
  export interface TargetCrashedEvent {}
  /** Fired when debugging target has reloaded after crash */
  export interface TargetReloadedAfterCrashEvent {}
  /**
   * Fired on worker targets when main worker script and any imported scripts have been evaluated.
   * @experimental
   */
  export interface WorkerScriptLoadedEvent {}
}

/**
 * Input/Output operations for streams produced by DevTools.
 */
export namespace IO {
  /**
   * This is either obtained from another method or specified as `blob:<uuid>` where
   * `<uuid>` is an UUID of a Blob.
   */
  export type StreamHandle = string;
  /** Close the stream, discard any temporary backing storage. */
  export interface CloseRequest {
    handle: IO.StreamHandle;
  }
  export interface CloseResponse {}
  /** Read a chunk of the stream */
  export interface ReadRequest {
    handle: IO.StreamHandle;
    offset?: number;
    size?: number;
  }
  export interface ReadResponse {
    base64Encoded?: boolean;
    data: string;
    eof: boolean;
  }
  /** Return UUID of Blob object specified by a remote object id. */
  export interface ResolveBlobRequest {
    objectId: Runtime.RemoteObjectId;
  }
  export interface ResolveBlobResponse {
    uuid: string;
  }
}

/**
 * LayerTree
 * @experimental
 */
export namespace LayerTree {
  /** Information about a compositing layer. */
  export interface Layer {
    layerId: LayerTree.LayerId;
    parentLayerId?: LayerTree.LayerId;
    backendNodeId?: DOM.BackendNodeId;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    transform?: number[];
    anchorX?: number;
    anchorY?: number;
    anchorZ?: number;
    paintCount: number;
    drawsContent: boolean;
    invisible?: boolean;
    scrollRects?: LayerTree.ScrollRect[];
    stickyPositionConstraint?: LayerTree.StickyPositionConstraint;
  }
  /** Unique Layer identifier. */
  export type LayerId = string;
  /** Array of timings, one per paint step. */
  export type PaintProfile = number[];
  /** Serialized fragment of layer picture along with its offset within the layer. */
  export interface PictureTile {
    x: number;
    y: number;
    picture: string;
  }
  /** Rectangle where scrolling happens on the main thread. */
  export interface ScrollRect {
    rect: DOM.Rect;
    type: "RepaintsOnScroll" | "TouchEventHandler" | "WheelEventHandler";
  }
  /** Unique snapshot identifier. */
  export type SnapshotId = string;
  /** Sticky position constraints. */
  export interface StickyPositionConstraint {
    stickyBoxRect: DOM.Rect;
    containingBlockRect: DOM.Rect;
    nearestLayerShiftingStickyBox?: LayerTree.LayerId;
    nearestLayerShiftingContainingBlock?: LayerTree.LayerId;
  }
  /** Provides the reasons why the given layer was composited. */
  export interface CompositingReasonsRequest {
    layerId: LayerTree.LayerId;
  }
  export interface CompositingReasonsResponse {
    compositingReasons: string[];
    compositingReasonIds: string[];
  }
  /** Disables compositing tree inspection. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables compositing tree inspection. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Returns the snapshot identifier. */
  export interface LoadSnapshotRequest {
    tiles: LayerTree.PictureTile[];
  }
  export interface LoadSnapshotResponse {
    snapshotId: LayerTree.SnapshotId;
  }
  /** Returns the layer snapshot identifier. */
  export interface MakeSnapshotRequest {
    layerId: LayerTree.LayerId;
  }
  export interface MakeSnapshotResponse {
    snapshotId: LayerTree.SnapshotId;
  }
  export interface ProfileSnapshotRequest {
    snapshotId: LayerTree.SnapshotId;
    minRepeatCount?: number;
    minDuration?: number;
    clipRect?: DOM.Rect;
  }
  export interface ProfileSnapshotResponse {
    timings: LayerTree.PaintProfile[];
  }
  /** Releases layer snapshot captured by the back-end. */
  export interface ReleaseSnapshotRequest {
    snapshotId: LayerTree.SnapshotId;
  }
  export interface ReleaseSnapshotResponse {}
  /** Replays the layer snapshot and returns the resulting bitmap. */
  export interface ReplaySnapshotRequest {
    snapshotId: LayerTree.SnapshotId;
    fromStep?: number;
    toStep?: number;
    scale?: number;
  }
  export interface ReplaySnapshotResponse {
    dataURL: string;
  }
  /** Replays the layer snapshot and returns canvas log. */
  export interface SnapshotCommandLogRequest {
    snapshotId: LayerTree.SnapshotId;
  }
  export interface SnapshotCommandLogResponse {
    commandLog: Record<string, unknown>[];
  }
  export interface LayerPaintedEvent {
    layerId: LayerTree.LayerId;
    clip: DOM.Rect;
  }
  export interface LayerTreeDidChangeEvent {
    layers?: LayerTree.Layer[];
  }
}

/**
 * Provides access to log entries.
 */
export namespace Log {
  /** Log entry. */
  export interface LogEntry {
    source: "xml" | "javascript" | "network" | "storage" | "appcache" | "rendering" | "security" | "deprecation" | "worker" | "violation" | "intervention" | "recommendation" | "other";
    level: "verbose" | "info" | "warning" | "error";
    text: string;
    category?: "cors";
    timestamp: Runtime.Timestamp;
    url?: string;
    lineNumber?: number;
    stackTrace?: Runtime.StackTrace;
    networkRequestId?: Network.RequestId;
    workerId?: string;
    args?: Runtime.RemoteObject[];
  }
  /** Violation configuration setting. */
  export interface ViolationSetting {
    name: "longTask" | "longLayout" | "blockedEvent" | "blockedParser" | "discouragedAPIUse" | "handler" | "recurringHandler";
    threshold: number;
  }
  /** Clears the log. */
  export interface ClearRequest {}
  export interface ClearResponse {}
  /** Disables log domain, prevents further log entries from being reported to the client. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables log domain, sends the entries collected so far to the client by means of the
   * `entryAdded` notification.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** start violation reporting. */
  export interface StartViolationsReportRequest {
    config: Log.ViolationSetting[];
  }
  export interface StartViolationsReportResponse {}
  /** Stop violation reporting. */
  export interface StopViolationsReportRequest {}
  export interface StopViolationsReportResponse {}
  /** Issued when new message was logged. */
  export interface EntryAddedEvent {
    entry: Log.LogEntry;
  }
}

/**
 * This domain allows detailed inspection of media elements.
 * @experimental
 */
export namespace Media {
  export interface Player {
    playerId: Media.PlayerId;
    domNodeId?: DOM.BackendNodeId;
  }
  /** Corresponds to kMediaError */
  export interface PlayerError {
    errorType: string;
    code: number;
    stack: Media.PlayerErrorSourceLocation[];
    cause: Media.PlayerError[];
    data: Record<string, unknown>;
  }
  /**
   * Represents logged source line numbers reported in an error.
   * NOTE: file and line are from chromium c++ implementation code, not js.
   */
  export interface PlayerErrorSourceLocation {
    file: string;
    line: number;
  }
  /** Corresponds to kMediaEventTriggered */
  export interface PlayerEvent {
    timestamp: Media.Timestamp;
    value: string;
  }
  /** Players will get an ID that is unique within the agent context. */
  export type PlayerId = string;
  /**
   * Have one type per entry in MediaLogRecord::Type
   * Corresponds to kMessage
   */
  export interface PlayerMessage {
    level: "error" | "warning" | "info" | "debug";
    message: string;
  }
  /** Corresponds to kMediaPropertyChange */
  export interface PlayerProperty {
    name: string;
    value: string;
  }
  export type Timestamp = number;
  /** Disables the Media domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables the Media domain */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Called whenever a player is created, or when a new agent joins and receives
   * a list of active players. If an agent is restored, it will receive one
   * event for each active player.
   */
  export interface PlayerCreatedEvent {
    player: Media.Player;
  }
  /** Send a list of any errors that need to be delivered. */
  export interface PlayerErrorsRaisedEvent {
    playerId: Media.PlayerId;
    errors: Media.PlayerError[];
  }
  /**
   * Send events as a list, allowing them to be batched on the browser for less
   * congestion. If batched, events must ALWAYS be in chronological order.
   */
  export interface PlayerEventsAddedEvent {
    playerId: Media.PlayerId;
    events: Media.PlayerEvent[];
  }
  /** Send a list of any messages that need to be delivered. */
  export interface PlayerMessagesLoggedEvent {
    playerId: Media.PlayerId;
    messages: Media.PlayerMessage[];
  }
  /**
   * This can be called multiple times, and can be used to set / override /
   * remove player properties. A null propValue indicates removal.
   */
  export interface PlayerPropertiesChangedEvent {
    playerId: Media.PlayerId;
    properties: Media.PlayerProperty[];
  }
}

/**
 * Memory
 * @experimental
 */
export namespace Memory {
  /** DOM object counter data. */
  export interface DOMCounter {
    name: string;
    count: number;
  }
  /** Executable module information */
  export interface Module {
    name: string;
    uuid: string;
    baseAddress: string;
    size: number;
  }
  /** Memory pressure level. */
  export type PressureLevel = "moderate" | "critical";
  /** Array of heap profile samples. */
  export interface SamplingProfile {
    samples: Memory.SamplingProfileNode[];
    modules: Memory.Module[];
  }
  /** Heap profile sample. */
  export interface SamplingProfileNode {
    size: number;
    total: number;
    stack: string[];
  }
  /** Simulate OomIntervention by purging V8 memory. */
  export interface ForciblyPurgeJavaScriptMemoryRequest {}
  export interface ForciblyPurgeJavaScriptMemoryResponse {}
  /**
   * Retrieve native memory allocations profile
   * collected since renderer process startup.
   */
  export interface GetAllTimeSamplingProfileRequest {}
  export interface GetAllTimeSamplingProfileResponse {
    profile: Memory.SamplingProfile;
  }
  /**
   * Retrieve native memory allocations profile
   * collected since browser process startup.
   */
  export interface GetBrowserSamplingProfileRequest {}
  export interface GetBrowserSamplingProfileResponse {
    profile: Memory.SamplingProfile;
  }
  /** Retruns current DOM object counters. */
  export interface GetDOMCountersRequest {}
  export interface GetDOMCountersResponse {
    documents: number;
    nodes: number;
    jsEventListeners: number;
  }
  /** Retruns DOM object counters after preparing renderer for leak detection. */
  export interface GetDOMCountersForLeakDetectionRequest {}
  export interface GetDOMCountersForLeakDetectionResponse {
    counters: Memory.DOMCounter[];
  }
  /**
   * Retrieve native memory allocations profile collected since last
   * `startSampling` call.
   */
  export interface GetSamplingProfileRequest {}
  export interface GetSamplingProfileResponse {
    profile: Memory.SamplingProfile;
  }
  /**
   * Prepares for leak detection by terminating workers, stopping spellcheckers,
   * dropping non-essential internal caches, running garbage collections, etc.
   */
  export interface PrepareForLeakDetectionRequest {}
  export interface PrepareForLeakDetectionResponse {}
  /** Enable/disable suppressing memory pressure notifications in all processes. */
  export interface SetPressureNotificationsSuppressedRequest {
    suppressed: boolean;
  }
  export interface SetPressureNotificationsSuppressedResponse {}
  /** Simulate a memory pressure notification in all processes. */
  export interface SimulatePressureNotificationRequest {
    level: Memory.PressureLevel;
  }
  export interface SimulatePressureNotificationResponse {}
  /** Start collecting native memory profile. */
  export interface StartSamplingRequest {
    samplingInterval?: number;
    suppressRandomness?: boolean;
  }
  export interface StartSamplingResponse {}
  /** Stop collecting native memory profile. */
  export interface StopSamplingRequest {}
  export interface StopSamplingResponse {}
}

/**
 * Network domain allows tracking network activities of the page. It exposes information about http,
file, data and other requests and responses, their headers, bodies, timing, etc.
 */
export namespace Network {
  /**
   * Encapsulates the script ancestry and the root script filter list rule that
   * caused the resource or element to be labeled as an ad.
   * @experimental
   */
  export interface AdAncestry {
    ancestryChain: Network.AdScriptIdentifier[];
    rootScriptFilterlistRule?: string;
  }
  /**
   * Represents the provenance of an ad resource or element. Only one of
   * `filterlistRule` or `adScriptAncestry` can be set. If `filterlistRule`
   * is provided, the resource URL directly matches a filter list rule. If
   * `adScriptAncestry` is provided, an ad script initiated the resource fetch or
   * appended the element to the DOM. If neither is provided, the entity is
   * known to be an ad, but provenance tracking information is unavailable.
   * @experimental
   */
  export interface AdProvenance {
    filterlistRule?: string;
    adScriptAncestry?: Network.AdAncestry;
  }
  /**
   * Identifies the script on the stack that caused a resource or element to be
   * labeled as an ad. For resources, this indicates the context that triggered
   * the fetch. For elements, this indicates the context that caused the element
   * to be appended to the DOM.
   * @experimental
   */
  export interface AdScriptIdentifier {
    scriptId: Runtime.ScriptId;
    debuggerId: Runtime.UniqueDebuggerId;
    name: string;
  }
  /**
   * The reason why Chrome uses a specific transport protocol for HTTP semantics.
   * @experimental
   */
  export type AlternateProtocolUsage = "alternativeJobWonWithoutRace" | "alternativeJobWonRace" | "mainJobWonRace" | "mappingMissing" | "broken" | "dnsAlpnH3JobWonWithoutRace" | "dnsAlpnH3JobWonRace" | "unspecifiedReason";
  /**
   * A cookie associated with the request which may or may not be sent with it.
   * Includes the cookies itself and reasons for blocking or exemption.
   * @experimental
   */
  export interface AssociatedCookie {
    cookie: Network.Cookie;
    blockedReasons: Network.CookieBlockedReason[];
    exemptionReason?: Network.CookieExemptionReason;
  }
  /**
   * Authorization challenge for HTTP status code 401 or 407.
   * @experimental
   */
  export interface AuthChallenge {
    source?: "Server" | "Proxy";
    origin: string;
    scheme: string;
    realm: string;
  }
  /**
   * Response to an AuthChallenge.
   * @experimental
   */
  export interface AuthChallengeResponse {
    response: "Default" | "CancelAuth" | "ProvideCredentials";
    username?: string;
    password?: string;
  }
  /** The reason why request was blocked. */
  export type BlockedReason = "other" | "csp" | "mixed-content" | "origin" | "inspector" | "integrity" | "subresource-filter" | "content-type" | "coep-frame-resource-needs-coep-header" | "coop-sandboxed-iframe-cannot-navigate-to-coop-page" | "corp-not-same-origin" | "corp-not-same-origin-after-defaulted-to-same-origin-by-coep" | "corp-not-same-origin-after-defaulted-to-same-origin-by-dip" | "corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip" | "corp-not-same-site" | "sri-message-signature-mismatch";
  /**
   * A cookie which was not stored from a response with the corresponding reason.
   * @experimental
   */
  export interface BlockedSetCookieWithReason {
    blockedReasons: Network.SetCookieBlockedReason[];
    cookieLine: string;
    cookie?: Network.Cookie;
  }
  /** @experimental */
  export interface BlockPattern {
    urlPattern: string;
    block: boolean;
  }
  /** Information about the cached resource. */
  export interface CachedResource {
    url: string;
    type: Network.ResourceType;
    response?: Network.Response;
    bodySize: number;
  }
  /** Whether the request complied with Certificate Transparency policy. */
  export type CertificateTransparencyCompliance = "unknown" | "not-compliant" | "compliant";
  /**
   * Session event details specific to challenges.
   * @experimental
   */
  export interface ChallengeEventDetails {
    challengeResult: "Success" | "NoSessionId" | "NoSessionMatch" | "CantSetBoundCookie";
    challenge: string;
  }
  /** @experimental */
  export interface ClientSecurityState {
    initiatorIsSecureContext: boolean;
    initiatorIPAddressSpace: Network.IPAddressSpace;
    localNetworkAccessRequestPolicy: Network.LocalNetworkAccessRequestPolicy;
  }
  /** The underlying connection technology that the browser is supposedly using. */
  export type ConnectionType = "none" | "cellular2g" | "cellular3g" | "cellular4g" | "bluetooth" | "ethernet" | "wifi" | "wimax" | "other";
  /** @experimental */
  export interface ConnectTiming {
    requestTime: number;
  }
  /**
   * List of content encodings supported by the backend.
   * @experimental
   */
  export type ContentEncoding = "deflate" | "gzip" | "br" | "zstd";
  /** @experimental */
  export type ContentSecurityPolicySource = "HTTP" | "Meta";
  /** @experimental */
  export interface ContentSecurityPolicyStatus {
    effectiveDirectives: string;
    isEnforced: boolean;
    source: Network.ContentSecurityPolicySource;
  }
  /** Cookie object */
  export interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    size: number;
    httpOnly: boolean;
    secure: boolean;
    session: boolean;
    sameSite?: Network.CookieSameSite;
    priority: Network.CookiePriority;
    sourceScheme: Network.CookieSourceScheme;
    sourcePort: number;
    partitionKey?: Network.CookiePartitionKey;
    partitionKeyOpaque?: boolean;
  }
  /**
   * Types of reasons why a cookie may not be sent with a request.
   * @experimental
   */
  export type CookieBlockedReason = "SecureOnly" | "NotOnPath" | "DomainMismatch" | "SameSiteStrict" | "SameSiteLax" | "SameSiteUnspecifiedTreatedAsLax" | "SameSiteNoneInsecure" | "UserPreferences" | "ThirdPartyPhaseout" | "ThirdPartyBlockedInFirstPartySet" | "UnknownError" | "SchemefulSameSiteStrict" | "SchemefulSameSiteLax" | "SchemefulSameSiteUnspecifiedTreatedAsLax" | "NameValuePairExceedsMaxSize" | "PortMismatch" | "SchemeMismatch" | "AnonymousContext";
  /**
   * Types of reasons why a cookie should have been blocked by 3PCD but is exempted for the request.
   * @experimental
   */
  export type CookieExemptionReason = "None" | "UserSetting" | "TPCDMetadata" | "TPCDDeprecationTrial" | "TopLevelTPCDDeprecationTrial" | "TPCDHeuristics" | "EnterprisePolicy" | "StorageAccess" | "TopLevelStorageAccess" | "Scheme" | "SameSiteNoneCookiesInSandbox";
  /** Cookie parameter object */
  export interface CookieParam {
    name: string;
    value: string;
    url?: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: Network.CookieSameSite;
    expires?: Network.TimeSinceEpoch;
    priority?: Network.CookiePriority;
    sourceScheme?: Network.CookieSourceScheme;
    sourcePort?: number;
    partitionKey?: Network.CookiePartitionKey;
  }
  /**
   * cookiePartitionKey object
   * The representation of the components of the key that are created by the cookiePartitionKey class contained in net/cookies/cookie_partition_key.h.
   * @experimental
   */
  export interface CookiePartitionKey {
    topLevelSite: string;
    hasCrossSiteAncestor: boolean;
  }
  /**
   * Represents the cookie's 'Priority' status:
   * https://tools.ietf.org/html/draft-west-cookie-priority-00
   * @experimental
   */
  export type CookiePriority = "Low" | "Medium" | "High";
  /**
   * Represents the cookie's 'SameSite' status:
   * https://tools.ietf.org/html/draft-west-first-party-cookies
   */
  export type CookieSameSite = "Strict" | "Lax" | "None";
  /**
   * Represents the source scheme of the origin that originally set the cookie.
   * A value of "Unset" allows protocol clients to emulate legacy cookie scope for the scheme.
   * This is a temporary ability and it will be removed in the future.
   * @experimental
   */
  export type CookieSourceScheme = "Unset" | "NonSecure" | "Secure";
  /** The reason why request was blocked. */
  export type CorsError = "DisallowedByMode" | "InvalidResponse" | "WildcardOriginNotAllowed" | "MissingAllowOriginHeader" | "MultipleAllowOriginValues" | "InvalidAllowOriginValue" | "AllowOriginMismatch" | "InvalidAllowCredentials" | "CorsDisabledScheme" | "PreflightInvalidStatus" | "PreflightDisallowedRedirect" | "PreflightWildcardOriginNotAllowed" | "PreflightMissingAllowOriginHeader" | "PreflightMultipleAllowOriginValues" | "PreflightInvalidAllowOriginValue" | "PreflightAllowOriginMismatch" | "PreflightInvalidAllowCredentials" | "PreflightMissingAllowExternal" | "PreflightInvalidAllowExternal" | "InvalidAllowMethodsPreflightResponse" | "InvalidAllowHeadersPreflightResponse" | "MethodDisallowedByPreflightResponse" | "HeaderDisallowedByPreflightResponse" | "RedirectContainsCredentials" | "InsecureLocalNetwork" | "InvalidLocalNetworkAccess" | "NoCorsRedirectModeNotFollow" | "LocalNetworkAccessPermissionDenied";
  export interface CorsErrorStatus {
    corsError: Network.CorsError;
    failedParameter: string;
  }
  /**
   * Session event details specific to creation.
   * @experimental
   */
  export interface CreationEventDetails {
    fetchResult: Network.DeviceBoundSessionFetchResult;
    newSession?: Network.DeviceBoundSession;
    failedRequest?: Network.DeviceBoundSessionFailedRequest;
  }
  /** @experimental */
  export interface CrossOriginEmbedderPolicyStatus {
    value: Network.CrossOriginEmbedderPolicyValue;
    reportOnlyValue: Network.CrossOriginEmbedderPolicyValue;
    reportingEndpoint?: string;
    reportOnlyReportingEndpoint?: string;
  }
  /** @experimental */
  export type CrossOriginEmbedderPolicyValue = "None" | "Credentialless" | "RequireCorp";
  /** @experimental */
  export interface CrossOriginOpenerPolicyStatus {
    value: Network.CrossOriginOpenerPolicyValue;
    reportOnlyValue: Network.CrossOriginOpenerPolicyValue;
    reportingEndpoint?: string;
    reportOnlyReportingEndpoint?: string;
  }
  /** @experimental */
  export type CrossOriginOpenerPolicyValue = "SameOrigin" | "SameOriginAllowPopups" | "RestrictProperties" | "UnsafeNone" | "SameOriginPlusCoep" | "RestrictPropertiesPlusCoep" | "NoopenerAllowPopups";
  /**
   * A device bound session.
   * @experimental
   */
  export interface DeviceBoundSession {
    key: Network.DeviceBoundSessionKey;
    refreshUrl: string;
    inclusionRules: Network.DeviceBoundSessionInclusionRules;
    cookieCravings: Network.DeviceBoundSessionCookieCraving[];
    expiryDate: Network.TimeSinceEpoch;
    cachedChallenge?: string;
    allowedRefreshInitiators: string[];
  }
  /**
   * A device bound session's cookie craving.
   * @experimental
   */
  export interface DeviceBoundSessionCookieCraving {
    name: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite?: Network.CookieSameSite;
  }
  /**
   * A unique identifier for a device bound session event.
   * @experimental
   */
  export type DeviceBoundSessionEventId = string;
  /**
   * Details about a failed device bound session network request.
   * @experimental
   */
  export interface DeviceBoundSessionFailedRequest {
    requestUrl: string;
    netError?: string;
    responseError?: number;
    responseErrorBody?: string;
  }
  /**
   * A fetch result for a device bound session creation or refresh.
   * @experimental
   */
  export type DeviceBoundSessionFetchResult = "Success" | "KeyError" | "SigningError" | "ServerRequestedTermination" | "InvalidSessionId" | "InvalidChallenge" | "TooManyChallenges" | "InvalidFetcherUrl" | "InvalidRefreshUrl" | "TransientHttpError" | "ScopeOriginSameSiteMismatch" | "RefreshUrlSameSiteMismatch" | "MismatchedSessionId" | "MissingScope" | "NoCredentials" | "SubdomainRegistrationWellKnownUnavailable" | "SubdomainRegistrationUnauthorized" | "SubdomainRegistrationWellKnownMalformed" | "SessionProviderWellKnownUnavailable" | "RelyingPartyWellKnownUnavailable" | "FederatedKeyThumbprintMismatch" | "InvalidFederatedSessionUrl" | "InvalidFederatedKey" | "TooManyRelyingOriginLabels" | "BoundCookieSetForbidden" | "NetError" | "ProxyError" | "EmptySessionConfig" | "InvalidCredentialsConfig" | "InvalidCredentialsType" | "InvalidCredentialsEmptyName" | "InvalidCredentialsCookie" | "PersistentHttpError" | "RegistrationAttemptedChallenge" | "InvalidScopeOrigin" | "ScopeOriginContainsPath" | "RefreshInitiatorNotString" | "RefreshInitiatorInvalidHostPattern" | "InvalidScopeSpecification" | "MissingScopeSpecificationType" | "EmptyScopeSpecificationDomain" | "EmptyScopeSpecificationPath" | "InvalidScopeSpecificationType" | "InvalidScopeIncludeSite" | "MissingScopeIncludeSite" | "FederatedNotAuthorizedByProvider" | "FederatedNotAuthorizedByRelyingParty" | "SessionProviderWellKnownMalformed" | "SessionProviderWellKnownHasProviderOrigin" | "RelyingPartyWellKnownMalformed" | "RelyingPartyWellKnownHasRelyingOrigins" | "InvalidFederatedSessionProviderSessionMissing" | "InvalidFederatedSessionWrongProviderOrigin" | "InvalidCredentialsCookieCreationTime" | "InvalidCredentialsCookieName" | "InvalidCredentialsCookieParsing" | "InvalidCredentialsCookieUnpermittedAttribute" | "InvalidCredentialsCookieInvalidDomain" | "InvalidCredentialsCookiePrefix" | "InvalidScopeRulePath" | "InvalidScopeRuleHostPattern" | "ScopeRuleOriginScopedHostPatternMismatch" | "ScopeRuleSiteScopedHostPatternMismatch" | "SigningQuotaExceeded" | "InvalidConfigJson" | "InvalidFederatedSessionProviderFailedToRestoreKey" | "FailedToUnwrapKey" | "SessionDeletedDuringRefresh";
  /**
   * A device bound session's inclusion rules.
   * @experimental
   */
  export interface DeviceBoundSessionInclusionRules {
    origin: string;
    includeSite: boolean;
    urlRules: Network.DeviceBoundSessionUrlRule[];
  }
  /**
   * Unique identifier for a device bound session.
   * @experimental
   */
  export interface DeviceBoundSessionKey {
    site: string;
    id: string;
  }
  /**
   * A device bound session's inclusion URL rule.
   * @experimental
   */
  export interface DeviceBoundSessionUrlRule {
    ruleType: "Exclude" | "Include";
    hostPattern: string;
    pathPrefix: string;
  }
  /**
   * How a device bound session was used during a request.
   * @experimental
   */
  export interface DeviceBoundSessionWithUsage {
    sessionKey: Network.DeviceBoundSessionKey;
    usage: "NotInScope" | "InScopeRefreshNotYetNeeded" | "InScopeRefreshNotAllowed" | "ProactiveRefreshNotPossible" | "ProactiveRefreshAttempted" | "Deferred";
  }
  /** @experimental */
  export type DirectSocketDnsQueryType = "ipv4" | "ipv6";
  /** @experimental */
  export interface DirectTCPSocketOptions {
    noDelay: boolean;
    keepAliveDelay?: number;
    sendBufferSize?: number;
    receiveBufferSize?: number;
    dnsQueryType?: Network.DirectSocketDnsQueryType;
  }
  /** @experimental */
  export interface DirectUDPMessage {
    data: string;
    remoteAddr?: string;
    remotePort?: number;
  }
  /** @experimental */
  export interface DirectUDPSocketOptions {
    remoteAddr?: string;
    remotePort?: number;
    localAddr?: string;
    localPort?: number;
    dnsQueryType?: Network.DirectSocketDnsQueryType;
    sendBufferSize?: number;
    receiveBufferSize?: number;
    multicastLoopback?: boolean;
    multicastTimeToLive?: number;
    multicastAllowAddressSharing?: boolean;
  }
  /** Network level fetch failure reason. */
  export type ErrorReason = "Failed" | "Aborted" | "TimedOut" | "AccessDenied" | "ConnectionClosed" | "ConnectionReset" | "ConnectionRefused" | "ConnectionAborted" | "ConnectionFailed" | "NameNotResolved" | "InternetDisconnected" | "AddressUnreachable" | "BlockedByClient" | "BlockedByResponse";
  /**
   * A cookie should have been blocked by 3PCD but is exempted and stored from a response with the
   * corresponding reason. A cookie could only have at most one exemption reason.
   * @experimental
   */
  export interface ExemptedSetCookieWithReason {
    exemptionReason: Network.CookieExemptionReason;
    cookieLine: string;
    cookie: Network.Cookie;
  }
  /** Request / response headers as keys / values of JSON object. */
  export type Headers = Record<string, unknown>;
  /** Information about the request initiator. */
  export interface Initiator {
    type: "parser" | "script" | "preload" | "SignedExchange" | "preflight" | "FedCM" | "other";
    stack?: Runtime.StackTrace;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    requestId?: Network.RequestId;
  }
  /** Unique intercepted request identifier. */
  export type InterceptionId = string;
  /**
   * Stages of the interception to begin intercepting. Request will intercept before the request is
   * sent. Response will intercept after the response is received.
   * @experimental
   */
  export type InterceptionStage = "Request" | "HeadersReceived";
  /** @experimental */
  export type IPAddressSpace = "Loopback" | "Local" | "Public" | "Unknown";
  /** Unique loader identifier. */
  export type LoaderId = string;
  /**
   * An options object that may be extended later to better support CORS,
   * CORB and streaming.
   * @experimental
   */
  export interface LoadNetworkResourceOptions {
    disableCache: boolean;
    includeCredentials: boolean;
  }
  /**
   * An object providing the result of a network resource load.
   * @experimental
   */
  export interface LoadNetworkResourcePageResult {
    success: boolean;
    netError?: number;
    netErrorName?: string;
    httpStatusCode?: number;
    stream?: IO.StreamHandle;
    headers?: Network.Headers;
  }
  /** @experimental */
  export type LocalNetworkAccessRequestPolicy = "Allow" | "BlockFromInsecureToMorePrivate" | "WarnFromInsecureToMorePrivate" | "PermissionBlock" | "PermissionWarn";
  /** Monotonically increasing time in seconds since an arbitrary point in the past. */
  export type MonotonicTime = number;
  /** @experimental */
  export interface NetworkConditions {
    urlPattern: string;
    latency: number;
    downloadThroughput: number;
    uploadThroughput: number;
    connectionType?: Network.ConnectionType;
    packetLoss?: number;
    packetQueueLength?: number;
    packetReordering?: boolean;
    offline?: boolean;
  }
  /** Post data entry for HTTP request */
  export interface PostDataEntry {
    bytes?: string;
  }
  /**
   * Session event details specific to refresh.
   * @experimental
   */
  export interface RefreshEventDetails {
    refreshResult: "Refreshed" | "RefreshedAsWaiter" | "InitializedService" | "Unreachable" | "ServerError" | "RefreshQuotaExceeded" | "FatalError" | "SigningQuotaExceeded";
    fetchResult?: Network.DeviceBoundSessionFetchResult;
    newSession?: Network.DeviceBoundSession;
    wasFullyProactiveRefresh: boolean;
    failedRequest?: Network.DeviceBoundSessionFailedRequest;
  }
  /**
   * The render-blocking behavior of a resource request.
   * @experimental
   */
  export type RenderBlockingBehavior = "Blocking" | "InBodyParserBlocking" | "NonBlocking" | "NonBlockingDynamic" | "PotentiallyBlocking";
  /** @experimental */
  export type ReportId = string;
  /** @experimental */
  export interface ReportingApiEndpoint {
    url: string;
    groupName: string;
  }
  /**
   * An object representing a report generated by the Reporting API.
   * @experimental
   */
  export interface ReportingApiReport {
    id: Network.ReportId;
    initiatorUrl: string;
    destination: string;
    type: string;
    timestamp: Network.TimeSinceEpoch;
    depth: number;
    completedAttempts: number;
    body: Record<string, unknown>;
    status: Network.ReportStatus;
  }
  /**
   * The status of a Reporting API report.
   * @experimental
   */
  export type ReportStatus = "Queued" | "Pending" | "MarkedForRemoval" | "Success";
  /** HTTP request data. */
  export interface Request {
    url: string;
    urlFragment?: string;
    method: string;
    headers: Network.Headers;
    postData?: string;
    hasPostData?: boolean;
    postDataEntries?: Network.PostDataEntry[];
    mixedContentType?: Security.MixedContentType;
    initialPriority: Network.ResourcePriority;
    referrerPolicy: "unsafe-url" | "no-referrer-when-downgrade" | "no-referrer" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin";
    isLinkPreload?: boolean;
    trustTokenParams?: Network.TrustTokenParams;
    isSameSite?: boolean;
    isAdRelated?: boolean;
  }
  /**
   * Unique network request identifier.
   * Note that this does not identify individual HTTP requests that are part of
   * a network request.
   */
  export type RequestId = string;
  /**
   * Request pattern for interception.
   * @experimental
   */
  export interface RequestPattern {
    urlPattern?: string;
    resourceType?: Network.ResourceType;
    interceptionStage?: Network.InterceptionStage;
  }
  /** Loading priority of a resource request. */
  export type ResourcePriority = "VeryLow" | "Low" | "Medium" | "High" | "VeryHigh";
  /** Timing information for the request. */
  export interface ResourceTiming {
    requestTime: number;
    proxyStart: number;
    proxyEnd: number;
    dnsStart: number;
    dnsEnd: number;
    connectStart: number;
    connectEnd: number;
    sslStart: number;
    sslEnd: number;
    workerStart: number;
    workerReady: number;
    workerFetchStart: number;
    workerRespondWithSettled: number;
    workerRouterEvaluationStart?: number;
    workerCacheLookupStart?: number;
    sendStart: number;
    sendEnd: number;
    pushStart: number;
    pushEnd: number;
    receiveHeadersStart: number;
    receiveHeadersEnd: number;
  }
  /** Resource type as it was perceived by the rendering engine. */
  export type ResourceType = "Document" | "Stylesheet" | "Image" | "Media" | "Font" | "Script" | "TextTrack" | "XHR" | "Fetch" | "Prefetch" | "EventSource" | "WebSocket" | "Manifest" | "SignedExchange" | "Ping" | "CSPViolationReport" | "Preflight" | "FedCM" | "Other";
  /** HTTP response data. */
  export interface Response {
    url: string;
    status: number;
    statusText: string;
    headers: Network.Headers;
    headersText?: string;
    mimeType: string;
    charset: string;
    requestHeaders?: Network.Headers;
    requestHeadersText?: string;
    connectionReused: boolean;
    connectionId: number;
    remoteIPAddress?: string;
    remotePort?: number;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    fromPrefetchCache?: boolean;
    fromEarlyHints?: boolean;
    serviceWorkerRouterInfo?: Network.ServiceWorkerRouterInfo;
    encodedDataLength: number;
    timing?: Network.ResourceTiming;
    serviceWorkerResponseSource?: Network.ServiceWorkerResponseSource;
    responseTime?: Network.TimeSinceEpoch;
    cacheStorageCacheName?: string;
    protocol?: string;
    alternateProtocolUsage?: Network.AlternateProtocolUsage;
    securityState: Security.SecurityState;
    securityDetails?: Network.SecurityDetails;
  }
  /** Security details about a request. */
  export interface SecurityDetails {
    protocol: string;
    keyExchange: string;
    keyExchangeGroup?: string;
    cipher: string;
    mac?: string;
    certificateId: Security.CertificateId;
    subjectName: string;
    sanList: string[];
    issuer: string;
    validFrom: Network.TimeSinceEpoch;
    validTo: Network.TimeSinceEpoch;
    signedCertificateTimestampList: Network.SignedCertificateTimestamp[];
    certificateTransparencyCompliance: Network.CertificateTransparencyCompliance;
    serverSignatureAlgorithm?: number;
    encryptedClientHello: boolean;
  }
  /** @experimental */
  export interface SecurityIsolationStatus {
    coop?: Network.CrossOriginOpenerPolicyStatus;
    coep?: Network.CrossOriginEmbedderPolicyStatus;
    csp?: Network.ContentSecurityPolicyStatus[];
  }
  /** Source of serviceworker response. */
  export type ServiceWorkerResponseSource = "cache-storage" | "http-cache" | "fallback-code" | "network";
  /** @experimental */
  export interface ServiceWorkerRouterInfo {
    ruleIdMatched?: number;
    matchedSourceType?: Network.ServiceWorkerRouterSource;
    actualSourceType?: Network.ServiceWorkerRouterSource;
  }
  /** Source of service worker router. */
  export type ServiceWorkerRouterSource = "network" | "cache" | "fetch-event" | "race-network-and-fetch-handler" | "race-network-and-cache";
  /**
   * Types of reasons why a cookie may not be stored from a response.
   * @experimental
   */
  export type SetCookieBlockedReason = "SecureOnly" | "SameSiteStrict" | "SameSiteLax" | "SameSiteUnspecifiedTreatedAsLax" | "SameSiteNoneInsecure" | "UserPreferences" | "ThirdPartyPhaseout" | "ThirdPartyBlockedInFirstPartySet" | "SyntaxError" | "SchemeNotSupported" | "OverwriteSecure" | "InvalidDomain" | "InvalidPrefix" | "UnknownError" | "SchemefulSameSiteStrict" | "SchemefulSameSiteLax" | "SchemefulSameSiteUnspecifiedTreatedAsLax" | "NameValuePairExceedsMaxSize" | "DisallowedCharacter" | "NoCookieContent";
  /** Details of a signed certificate timestamp (SCT). */
  export interface SignedCertificateTimestamp {
    status: string;
    origin: string;
    logDescription: string;
    logId: string;
    timestamp: number;
    hashAlgorithm: string;
    signatureAlgorithm: string;
    signatureData: string;
  }
  /**
   * Information about a signed exchange response.
   * @experimental
   */
  export interface SignedExchangeError {
    message: string;
    signatureIndex?: number;
    errorField?: Network.SignedExchangeErrorField;
  }
  /**
   * Field type for a signed exchange related error.
   * @experimental
   */
  export type SignedExchangeErrorField = "signatureSig" | "signatureIntegrity" | "signatureCertUrl" | "signatureCertSha256" | "signatureValidityUrl" | "signatureTimestamps";
  /**
   * Information about a signed exchange header.
   * https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#cbor-representation
   * @experimental
   */
  export interface SignedExchangeHeader {
    requestUrl: string;
    responseCode: number;
    responseHeaders: Network.Headers;
    signatures: Network.SignedExchangeSignature[];
    headerIntegrity: string;
  }
  /**
   * Information about a signed exchange response.
   * @experimental
   */
  export interface SignedExchangeInfo {
    outerResponse: Network.Response;
    hasExtraInfo: boolean;
    header?: Network.SignedExchangeHeader;
    securityDetails?: Network.SecurityDetails;
    errors?: Network.SignedExchangeError[];
  }
  /**
   * Information about a signed exchange signature.
   * https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#rfc.section.3.1
   * @experimental
   */
  export interface SignedExchangeSignature {
    label: string;
    signature: string;
    integrity: string;
    certUrl?: string;
    certSha256?: string;
    validityUrl: string;
    date: number;
    expires: number;
    certificates?: string[];
  }
  /**
   * Session event details specific to termination.
   * @experimental
   */
  export interface TerminationEventDetails {
    deletionReason: "Expired" | "FailedToRestoreKey" | "FailedToUnwrapKey" | "StoragePartitionCleared" | "ClearBrowsingData" | "ServerRequested" | "InvalidSessionParams" | "RefreshFatalError" | "DevTools";
  }
  /** UTC time in seconds, counted from January 1, 1970. */
  export type TimeSinceEpoch = number;
  /** @experimental */
  export type TrustTokenOperationType = "Issuance" | "Redemption" | "Signing";
  /**
   * Determines what type of Trust Token operation is executed and
   * depending on the type, some additional parameters. The values
   * are specified in third_party/blink/renderer/core/fetch/trust_token.idl.
   * @experimental
   */
  export interface TrustTokenParams {
    operation: Network.TrustTokenOperationType;
    refreshPolicy: "UseCached" | "Refresh";
    issuers?: string[];
  }
  /** WebSocket message data. This represents an entire WebSocket message, not just a fragmented frame as the name suggests. */
  export interface WebSocketFrame {
    opcode: number;
    mask: boolean;
    payloadData: string;
  }
  /** WebSocket request data. */
  export interface WebSocketRequest {
    headers: Network.Headers;
  }
  /** WebSocket response data. */
  export interface WebSocketResponse {
    status: number;
    statusText: string;
    headers: Network.Headers;
    headersText?: string;
    requestHeaders?: Network.Headers;
    requestHeadersText?: string;
  }
  /**
   * Tells whether clearing browser cache is supported.
   * @deprecated
   */
  export interface CanClearBrowserCacheRequest {}
  export interface CanClearBrowserCacheResponse {
    result: boolean;
  }
  /**
   * Tells whether clearing browser cookies is supported.
   * @deprecated
   */
  export interface CanClearBrowserCookiesRequest {}
  export interface CanClearBrowserCookiesResponse {
    result: boolean;
  }
  /**
   * Tells whether emulation of network conditions is supported.
   * @deprecated
   */
  export interface CanEmulateNetworkConditionsRequest {}
  export interface CanEmulateNetworkConditionsResponse {
    result: boolean;
  }
  /**
   * Clears accepted encodings set by setAcceptedEncodings
   * @experimental
   */
  export interface ClearAcceptedEncodingsOverrideRequest {}
  export interface ClearAcceptedEncodingsOverrideResponse {}
  /** Clears browser cache. */
  export interface ClearBrowserCacheRequest {}
  export interface ClearBrowserCacheResponse {}
  /** Clears browser cookies. */
  export interface ClearBrowserCookiesRequest {}
  export interface ClearBrowserCookiesResponse {}
  /**
   * Configures storing response bodies outside of renderer, so that these survive
   * a cross-process navigation.
   * If maxTotalBufferSize is not set, durable messages are disabled.
   * @experimental
   */
  export interface ConfigureDurableMessagesRequest {
    maxTotalBufferSize?: number;
    maxResourceBufferSize?: number;
  }
  export interface ConfigureDurableMessagesResponse {}
  /**
   * Response to Network.requestIntercepted which either modifies the request to continue with any
   * modifications, or blocks it, or completes it with the provided response bytes. If a network
   * fetch occurs as a result which encounters a redirect an additional Network.requestIntercepted
   * event will be sent with the same InterceptionId.
   * Deprecated, use Fetch.continueRequest, Fetch.fulfillRequest and Fetch.failRequest instead.
   * @experimental
   * @deprecated
   */
  export interface ContinueInterceptedRequestRequest {
    interceptionId: Network.InterceptionId;
    errorReason?: Network.ErrorReason;
    rawResponse?: string;
    url?: string;
    method?: string;
    postData?: string;
    headers?: Network.Headers;
    authChallengeResponse?: Network.AuthChallengeResponse;
  }
  export interface ContinueInterceptedRequestResponse {}
  /** Deletes browser cookies with matching name and url or domain/path/partitionKey pair. */
  export interface DeleteCookiesRequest {
    name: string;
    url?: string;
    domain?: string;
    path?: string;
    partitionKey?: Network.CookiePartitionKey;
  }
  export interface DeleteCookiesResponse {}
  /**
   * Deletes a device bound session.
   * @experimental
   */
  export interface DeleteDeviceBoundSessionRequest {
    key: Network.DeviceBoundSessionKey;
  }
  export interface DeleteDeviceBoundSessionResponse {}
  /** Disables network tracking, prevents network events from being sent to the client. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Activates emulation of network conditions. This command is deprecated in favor of the emulateNetworkConditionsByRule
   * and overrideNetworkState commands, which can be used together to the same effect.
   * @deprecated
   */
  export interface EmulateNetworkConditionsRequest {
    offline: boolean;
    latency: number;
    downloadThroughput: number;
    uploadThroughput: number;
    connectionType?: Network.ConnectionType;
    packetLoss?: number;
    packetQueueLength?: number;
    packetReordering?: boolean;
  }
  export interface EmulateNetworkConditionsResponse {}
  /**
   * Activates emulation of network conditions for individual requests using URL match patterns. Unlike the deprecated
   * Network.emulateNetworkConditions this method does not affect `navigator` state. Use Network.overrideNetworkState to
   * explicitly modify `navigator` behavior.
   * @experimental
   */
  export interface EmulateNetworkConditionsByRuleRequest {
    offline?: boolean;
    emulateOfflineServiceWorker?: boolean;
    matchedNetworkConditions: Network.NetworkConditions[];
  }
  export interface EmulateNetworkConditionsByRuleResponse {
    ruleIds: string[];
  }
  /** Enables network tracking, network events will now be delivered to the client. */
  export interface EnableRequest {
    maxTotalBufferSize?: number;
    maxResourceBufferSize?: number;
    maxPostDataSize?: number;
    reportDirectSocketTraffic?: boolean;
    enableDurableMessages?: boolean;
  }
  export interface EnableResponse {}
  /**
   * Sets up tracking device bound sessions and fetching of initial set of sessions.
   * @experimental
   */
  export interface EnableDeviceBoundSessionsRequest {
    enable: boolean;
  }
  export interface EnableDeviceBoundSessionsResponse {}
  /**
   * Enables tracking for the Reporting API, events generated by the Reporting API will now be delivered to the client.
   * Enabling triggers 'reportingApiReportAdded' for all existing reports.
   * @experimental
   */
  export interface EnableReportingApiRequest {
    enable: boolean;
  }
  export interface EnableReportingApiResponse {}
  /**
   * Fetches the schemeful site for a specific origin.
   * @experimental
   */
  export interface FetchSchemefulSiteRequest {
    origin: string;
  }
  export interface FetchSchemefulSiteResponse {
    schemefulSite: string;
  }
  /**
   * Returns all browser cookies. Depending on the backend support, will return detailed cookie
   * information in the `cookies` field.
   * Deprecated. Use Storage.getCookies instead.
   * @deprecated
   */
  export interface GetAllCookiesRequest {}
  export interface GetAllCookiesResponse {
    cookies: Network.Cookie[];
  }
  /**
   * Returns the DER-encoded certificate.
   * @experimental
   */
  export interface GetCertificateRequest {
    origin: string;
  }
  export interface GetCertificateResponse {
    tableNames: string[];
  }
  /**
   * Returns all browser cookies for the current URL. Depending on the backend support, will return
   * detailed cookie information in the `cookies` field.
   */
  export interface GetCookiesRequest {
    urls?: string[];
  }
  export interface GetCookiesResponse {
    cookies: Network.Cookie[];
  }
  /** Returns post data sent with the request. Returns an error when no data was sent with the request. */
  export interface GetRequestPostDataRequest {
    requestId: Network.RequestId;
  }
  export interface GetRequestPostDataResponse {
    postData: string;
    base64Encoded: boolean;
  }
  /** Returns content served for the given request. */
  export interface GetResponseBodyRequest {
    requestId: Network.RequestId;
  }
  export interface GetResponseBodyResponse {
    body: string;
    base64Encoded: boolean;
  }
  /**
   * Returns content served for the given currently intercepted request.
   * @experimental
   */
  export interface GetResponseBodyForInterceptionRequest {
    interceptionId: Network.InterceptionId;
  }
  export interface GetResponseBodyForInterceptionResponse {
    body: string;
    base64Encoded: boolean;
  }
  /**
   * Returns information about the COEP/COOP isolation status.
   * @experimental
   */
  export interface GetSecurityIsolationStatusRequest {
    frameId?: Page.FrameId;
  }
  export interface GetSecurityIsolationStatusResponse {
    status: Network.SecurityIsolationStatus;
  }
  /**
   * Fetches the resource and returns the content.
   * @experimental
   */
  export interface LoadNetworkResourceRequest {
    frameId?: Page.FrameId;
    url: string;
    options: Network.LoadNetworkResourceOptions;
  }
  export interface LoadNetworkResourceResponse {
    resource: Network.LoadNetworkResourcePageResult;
  }
  /**
   * Override the state of navigator.onLine and navigator.connection.
   * @experimental
   */
  export interface OverrideNetworkStateRequest {
    offline: boolean;
    latency: number;
    downloadThroughput: number;
    uploadThroughput: number;
    connectionType?: Network.ConnectionType;
  }
  export interface OverrideNetworkStateResponse {}
  /**
   * This method sends a new XMLHttpRequest which is identical to the original one. The following
   * parameters should be identical: method, url, async, request body, extra headers, withCredentials
   * attribute, user, password.
   * @experimental
   */
  export interface ReplayXHRRequest {
    requestId: Network.RequestId;
  }
  export interface ReplayXHRResponse {}
  /**
   * Searches for given string in response content.
   * @experimental
   */
  export interface SearchInResponseBodyRequest {
    requestId: Network.RequestId;
    query: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
  }
  export interface SearchInResponseBodyResponse {
    result: Debugger.SearchMatch[];
  }
  /**
   * Sets a list of content encodings that will be accepted. Empty list means no encoding is accepted.
   * @experimental
   */
  export interface SetAcceptedEncodingsRequest {
    encodings: Network.ContentEncoding[];
  }
  export interface SetAcceptedEncodingsResponse {}
  /**
   * Specifies whether to attach a page script stack id in requests
   * @experimental
   */
  export interface SetAttachDebugStackRequest {
    enabled: boolean;
  }
  export interface SetAttachDebugStackResponse {}
  /**
   * Blocks URLs from loading.
   * @experimental
   */
  export interface SetBlockedURLsRequest {
    urlPatterns?: Network.BlockPattern[];
    urls?: string[];
  }
  export interface SetBlockedURLsResponse {}
  /** Toggles ignoring of service worker for each request. */
  export interface SetBypassServiceWorkerRequest {
    bypass: boolean;
  }
  export interface SetBypassServiceWorkerResponse {}
  /** Toggles ignoring cache for each request. If `true`, cache will not be used. */
  export interface SetCacheDisabledRequest {
    cacheDisabled: boolean;
  }
  export interface SetCacheDisabledResponse {}
  /** Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist. */
  export interface SetCookieRequest {
    name: string;
    value: string;
    url?: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: Network.CookieSameSite;
    expires?: Network.TimeSinceEpoch;
    priority?: Network.CookiePriority;
    sourceScheme?: Network.CookieSourceScheme;
    sourcePort?: number;
    partitionKey?: Network.CookiePartitionKey;
  }
  export interface SetCookieResponse {
    success: boolean;
  }
  /**
   * Sets Controls for third-party cookie access
   * Page reload is required before the new cookie behavior will be observed
   * @experimental
   */
  export interface SetCookieControlsRequest {
    enableThirdPartyCookieRestriction: boolean;
  }
  export interface SetCookieControlsResponse {}
  /** Sets given cookies. */
  export interface SetCookiesRequest {
    cookies: Network.CookieParam[];
  }
  export interface SetCookiesResponse {}
  /** Specifies whether to always send extra HTTP headers with the requests from this page. */
  export interface SetExtraHTTPHeadersRequest {
    headers: Network.Headers;
  }
  export interface SetExtraHTTPHeadersResponse {}
  /**
   * Sets the requests to intercept that match the provided patterns and optionally resource types.
   * Deprecated, please use Fetch.enable instead.
   * @experimental
   * @deprecated
   */
  export interface SetRequestInterceptionRequest {
    patterns: Network.RequestPattern[];
  }
  export interface SetRequestInterceptionResponse {}
  /**
   * Enables streaming of the response for the given requestId.
   * If enabled, the dataReceived event contains the data that was received during streaming.
   * @experimental
   */
  export interface StreamResourceContentRequest {
    requestId: Network.RequestId;
  }
  export interface StreamResourceContentResponse {
    bufferedData: string;
  }
  /**
   * Returns a handle to the stream representing the response body. Note that after this command,
   * the intercepted request can't be continued as is -- you either need to cancel it or to provide
   * the response body. The stream only supports sequential read, IO.read will fail if the position
   * is specified.
   * @experimental
   */
  export interface TakeResponseBodyForInterceptionAsStreamRequest {
    interceptionId: Network.InterceptionId;
  }
  export interface TakeResponseBodyForInterceptionAsStreamResponse {
    stream: IO.StreamHandle;
  }
  /** Fired when data chunk was received over the network. */
  export interface DataReceivedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    dataLength: number;
    encodedDataLength: number;
    data?: string;
  }
  /**
   * Triggered when a device bound session event occurs.
   * @experimental
   */
  export interface DeviceBoundSessionEventOccurredEvent {
    eventId: Network.DeviceBoundSessionEventId;
    site: string;
    succeeded: boolean;
    sessionId?: string;
    creationEventDetails?: Network.CreationEventDetails;
    refreshEventDetails?: Network.RefreshEventDetails;
    terminationEventDetails?: Network.TerminationEventDetails;
    challengeEventDetails?: Network.ChallengeEventDetails;
  }
  /**
   * Triggered when the initial set of device bound sessions is added.
   * @experimental
   */
  export interface DeviceBoundSessionsAddedEvent {
    sessions: Network.DeviceBoundSession[];
  }
  /**
   * Fired when direct_socket.TCPSocket is aborted.
   * @experimental
   */
  export interface DirectTCPSocketAbortedEvent {
    identifier: Network.RequestId;
    errorMessage: string;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when data is received from tcp direct socket stream.
   * @experimental
   */
  export interface DirectTCPSocketChunkReceivedEvent {
    identifier: Network.RequestId;
    data: string;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when data is sent to tcp direct socket stream.
   * @experimental
   */
  export interface DirectTCPSocketChunkSentEvent {
    identifier: Network.RequestId;
    data: string;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when direct_socket.TCPSocket is closed.
   * @experimental
   */
  export interface DirectTCPSocketClosedEvent {
    identifier: Network.RequestId;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired upon direct_socket.TCPSocket creation.
   * @experimental
   */
  export interface DirectTCPSocketCreatedEvent {
    identifier: Network.RequestId;
    remoteAddr: string;
    remotePort: number;
    options: Network.DirectTCPSocketOptions;
    timestamp: Network.MonotonicTime;
    initiator?: Network.Initiator;
  }
  /**
   * Fired when direct_socket.TCPSocket connection is opened.
   * @experimental
   */
  export interface DirectTCPSocketOpenedEvent {
    identifier: Network.RequestId;
    remoteAddr: string;
    remotePort: number;
    timestamp: Network.MonotonicTime;
    localAddr?: string;
    localPort?: number;
  }
  /**
   * Fired when direct_socket.UDPSocket is aborted.
   * @experimental
   */
  export interface DirectUDPSocketAbortedEvent {
    identifier: Network.RequestId;
    errorMessage: string;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when message is received from udp direct socket stream.
   * @experimental
   */
  export interface DirectUDPSocketChunkReceivedEvent {
    identifier: Network.RequestId;
    message: Network.DirectUDPMessage;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when message is sent to udp direct socket stream.
   * @experimental
   */
  export interface DirectUDPSocketChunkSentEvent {
    identifier: Network.RequestId;
    message: Network.DirectUDPMessage;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when direct_socket.UDPSocket is closed.
   * @experimental
   */
  export interface DirectUDPSocketClosedEvent {
    identifier: Network.RequestId;
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired upon direct_socket.UDPSocket creation.
   * @experimental
   */
  export interface DirectUDPSocketCreatedEvent {
    identifier: Network.RequestId;
    options: Network.DirectUDPSocketOptions;
    timestamp: Network.MonotonicTime;
    initiator?: Network.Initiator;
  }
  /** @experimental */
  export interface DirectUDPSocketJoinedMulticastGroupEvent {
    identifier: Network.RequestId;
    IPAddress: string;
  }
  /** @experimental */
  export interface DirectUDPSocketLeftMulticastGroupEvent {
    identifier: Network.RequestId;
    IPAddress: string;
  }
  /**
   * Fired when direct_socket.UDPSocket connection is opened.
   * @experimental
   */
  export interface DirectUDPSocketOpenedEvent {
    identifier: Network.RequestId;
    localAddr: string;
    localPort: number;
    timestamp: Network.MonotonicTime;
    remoteAddr?: string;
    remotePort?: number;
  }
  /** Fired when EventSource message is received. */
  export interface EventSourceMessageReceivedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    eventName: string;
    eventId: string;
    data: string;
  }
  /** Fired when HTTP request has failed to load. */
  export interface LoadingFailedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    type: Network.ResourceType;
    errorText: string;
    canceled?: boolean;
    blockedReason?: Network.BlockedReason;
    corsErrorStatus?: Network.CorsErrorStatus;
  }
  /** Fired when HTTP request has finished loading. */
  export interface LoadingFinishedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    encodedDataLength: number;
  }
  /**
   * Fired once security policy has been updated.
   * @experimental
   */
  export interface PolicyUpdatedEvent {}
  /** @experimental */
  export interface ReportingApiEndpointsChangedForOriginEvent {
    origin: string;
    endpoints: Network.ReportingApiEndpoint[];
  }
  /**
   * Is sent whenever a new report is added.
   * And after 'enableReportingApi' for all existing reports.
   * @experimental
   */
  export interface ReportingApiReportAddedEvent {
    report: Network.ReportingApiReport;
  }
  /** @experimental */
  export interface ReportingApiReportUpdatedEvent {
    report: Network.ReportingApiReport;
  }
  /**
   * Details of an intercepted HTTP request, which must be either allowed, blocked, modified or
   * mocked.
   * Deprecated, use Fetch.requestPaused instead.
   * @experimental
   * @deprecated
   */
  export interface RequestInterceptedEvent {
    interceptionId: Network.InterceptionId;
    request: Network.Request;
    frameId: Page.FrameId;
    resourceType: Network.ResourceType;
    isNavigationRequest: boolean;
    isDownload?: boolean;
    redirectUrl?: string;
    authChallenge?: Network.AuthChallenge;
    responseErrorReason?: Network.ErrorReason;
    responseStatusCode?: number;
    responseHeaders?: Network.Headers;
    requestId?: Network.RequestId;
  }
  /** Fired if request ended up loading from cache. */
  export interface RequestServedFromCacheEvent {
    requestId: Network.RequestId;
  }
  /** Fired when page is about to send HTTP request. */
  export interface RequestWillBeSentEvent {
    requestId: Network.RequestId;
    loaderId: Network.LoaderId;
    documentURL: string;
    request: Network.Request;
    timestamp: Network.MonotonicTime;
    wallTime: Network.TimeSinceEpoch;
    initiator: Network.Initiator;
    redirectHasExtraInfo: boolean;
    redirectResponse?: Network.Response;
    type?: Network.ResourceType;
    frameId?: Page.FrameId;
    hasUserGesture?: boolean;
    renderBlockingBehavior?: Network.RenderBlockingBehavior;
  }
  /**
   * Fired when additional information about a requestWillBeSent event is available from the
   * network stack. Not every requestWillBeSent event will have an additional
   * requestWillBeSentExtraInfo fired for it, and there is no guarantee whether requestWillBeSent
   * or requestWillBeSentExtraInfo will be fired first for the same request.
   * @experimental
   */
  export interface RequestWillBeSentExtraInfoEvent {
    requestId: Network.RequestId;
    associatedCookies: Network.AssociatedCookie[];
    headers: Network.Headers;
    connectTiming: Network.ConnectTiming;
    deviceBoundSessionUsages?: Network.DeviceBoundSessionWithUsage[];
    clientSecurityState?: Network.ClientSecurityState;
    siteHasCookieInOtherPartition?: boolean;
    appliedNetworkConditionsId?: string;
  }
  /**
   * Fired when resource loading priority is changed
   * @experimental
   */
  export interface ResourceChangedPriorityEvent {
    requestId: Network.RequestId;
    newPriority: Network.ResourcePriority;
    timestamp: Network.MonotonicTime;
  }
  /** Fired when HTTP response is available. */
  export interface ResponseReceivedEvent {
    requestId: Network.RequestId;
    loaderId: Network.LoaderId;
    timestamp: Network.MonotonicTime;
    type: Network.ResourceType;
    response: Network.Response;
    hasExtraInfo: boolean;
    frameId?: Page.FrameId;
  }
  /**
   * Fired when 103 Early Hints headers is received in addition to the common response.
   * Not every responseReceived event will have an responseReceivedEarlyHints fired.
   * Only one responseReceivedEarlyHints may be fired for eached responseReceived event.
   * @experimental
   */
  export interface ResponseReceivedEarlyHintsEvent {
    requestId: Network.RequestId;
    headers: Network.Headers;
  }
  /**
   * Fired when additional information about a responseReceived event is available from the network
   * stack. Not every responseReceived event will have an additional responseReceivedExtraInfo for
   * it, and responseReceivedExtraInfo may be fired before or after responseReceived.
   * @experimental
   */
  export interface ResponseReceivedExtraInfoEvent {
    requestId: Network.RequestId;
    blockedCookies: Network.BlockedSetCookieWithReason[];
    headers: Network.Headers;
    resourceIPAddressSpace: Network.IPAddressSpace;
    statusCode: number;
    headersText?: string;
    cookiePartitionKey?: Network.CookiePartitionKey;
    cookiePartitionKeyOpaque?: boolean;
    exemptedCookies?: Network.ExemptedSetCookieWithReason[];
  }
  /**
   * Fired when a signed exchange was received over the network
   * @experimental
   */
  export interface SignedExchangeReceivedEvent {
    requestId: Network.RequestId;
    info: Network.SignedExchangeInfo;
  }
  /**
   * Fired exactly once for each Trust Token operation. Depending on
   * the type of the operation and whether the operation succeeded or
   * failed, the event is fired before the corresponding request was sent
   * or after the response was received.
   * @experimental
   */
  export interface TrustTokenOperationDoneEvent {
    status: "Ok" | "InvalidArgument" | "MissingIssuerKeys" | "FailedPrecondition" | "ResourceExhausted" | "AlreadyExists" | "ResourceLimited" | "Unauthorized" | "BadResponse" | "InternalError" | "UnknownError" | "FulfilledLocally" | "SiteIssuerLimit";
    type: Network.TrustTokenOperationType;
    requestId: Network.RequestId;
    topLevelOrigin?: string;
    issuerOrigin?: string;
    issuedTokenCount?: number;
  }
  /** Fired when WebSocket is closed. */
  export interface WebSocketClosedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
  }
  /** Fired upon WebSocket creation. */
  export interface WebSocketCreatedEvent {
    requestId: Network.RequestId;
    url: string;
    initiator?: Network.Initiator;
  }
  /** Fired when WebSocket message error occurs. */
  export interface WebSocketFrameErrorEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    errorMessage: string;
  }
  /** Fired when WebSocket message is received. */
  export interface WebSocketFrameReceivedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    response: Network.WebSocketFrame;
  }
  /** Fired when WebSocket message is sent. */
  export interface WebSocketFrameSentEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    response: Network.WebSocketFrame;
  }
  /** Fired when WebSocket handshake response becomes available. */
  export interface WebSocketHandshakeResponseReceivedEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    response: Network.WebSocketResponse;
  }
  /** Fired when WebSocket is about to initiate handshake. */
  export interface WebSocketWillSendHandshakeRequestEvent {
    requestId: Network.RequestId;
    timestamp: Network.MonotonicTime;
    wallTime: Network.TimeSinceEpoch;
    request: Network.WebSocketRequest;
  }
  /** Fired when WebTransport is disposed. */
  export interface WebTransportClosedEvent {
    transportId: Network.RequestId;
    timestamp: Network.MonotonicTime;
  }
  /** Fired when WebTransport handshake is finished. */
  export interface WebTransportConnectionEstablishedEvent {
    transportId: Network.RequestId;
    timestamp: Network.MonotonicTime;
  }
  /** Fired upon WebTransport creation. */
  export interface WebTransportCreatedEvent {
    transportId: Network.RequestId;
    url: string;
    timestamp: Network.MonotonicTime;
    initiator?: Network.Initiator;
  }
}

/**
 * This domain provides various functionality related to drawing atop the inspected page.
 * @experimental
 */
export namespace Overlay {
  /** Style information for drawing a box. */
  export interface BoxStyle {
    fillColor?: DOM.RGBA;
    hatchColor?: DOM.RGBA;
  }
  export type ColorFormat = "rgb" | "hsl" | "hwb" | "hex";
  export interface ContainerQueryContainerHighlightConfig {
    containerBorder?: Overlay.LineStyle;
    descendantBorder?: Overlay.LineStyle;
  }
  export interface ContainerQueryHighlightConfig {
    containerQueryContainerHighlightConfig: Overlay.ContainerQueryContainerHighlightConfig;
    nodeId: DOM.NodeId;
  }
  export type ContrastAlgorithm = "aa" | "aaa" | "apca";
  /** Configuration data for the highlighting of Flex container elements. */
  export interface FlexContainerHighlightConfig {
    containerBorder?: Overlay.LineStyle;
    lineSeparator?: Overlay.LineStyle;
    itemSeparator?: Overlay.LineStyle;
    mainDistributedSpace?: Overlay.BoxStyle;
    crossDistributedSpace?: Overlay.BoxStyle;
    rowGapSpace?: Overlay.BoxStyle;
    columnGapSpace?: Overlay.BoxStyle;
    crossAlignment?: Overlay.LineStyle;
  }
  /** Configuration data for the highlighting of Flex item elements. */
  export interface FlexItemHighlightConfig {
    baseSizeBox?: Overlay.BoxStyle;
    baseSizeBorder?: Overlay.LineStyle;
    flexibilityArrow?: Overlay.LineStyle;
  }
  export interface FlexNodeHighlightConfig {
    flexContainerHighlightConfig: Overlay.FlexContainerHighlightConfig;
    nodeId: DOM.NodeId;
  }
  /** Configuration data for the highlighting of Grid elements. */
  export interface GridHighlightConfig {
    showGridExtensionLines?: boolean;
    showPositiveLineNumbers?: boolean;
    showNegativeLineNumbers?: boolean;
    showAreaNames?: boolean;
    showLineNames?: boolean;
    showTrackSizes?: boolean;
    gridBorderColor?: DOM.RGBA;
    cellBorderColor?: DOM.RGBA;
    rowLineColor?: DOM.RGBA;
    columnLineColor?: DOM.RGBA;
    gridBorderDash?: boolean;
    cellBorderDash?: boolean;
    rowLineDash?: boolean;
    columnLineDash?: boolean;
    rowGapColor?: DOM.RGBA;
    rowHatchColor?: DOM.RGBA;
    columnGapColor?: DOM.RGBA;
    columnHatchColor?: DOM.RGBA;
    areaBorderColor?: DOM.RGBA;
    gridBackgroundColor?: DOM.RGBA;
  }
  /** Configurations for Persistent Grid Highlight */
  export interface GridNodeHighlightConfig {
    gridHighlightConfig: Overlay.GridHighlightConfig;
    nodeId: DOM.NodeId;
  }
  /** Configuration data for the highlighting of page elements. */
  export interface HighlightConfig {
    showInfo?: boolean;
    showStyles?: boolean;
    showRulers?: boolean;
    showAccessibilityInfo?: boolean;
    showExtensionLines?: boolean;
    contentColor?: DOM.RGBA;
    paddingColor?: DOM.RGBA;
    borderColor?: DOM.RGBA;
    marginColor?: DOM.RGBA;
    eventTargetColor?: DOM.RGBA;
    shapeColor?: DOM.RGBA;
    shapeMarginColor?: DOM.RGBA;
    cssGridColor?: DOM.RGBA;
    colorFormat?: Overlay.ColorFormat;
    gridHighlightConfig?: Overlay.GridHighlightConfig;
    flexContainerHighlightConfig?: Overlay.FlexContainerHighlightConfig;
    flexItemHighlightConfig?: Overlay.FlexItemHighlightConfig;
    contrastAlgorithm?: Overlay.ContrastAlgorithm;
    containerQueryContainerHighlightConfig?: Overlay.ContainerQueryContainerHighlightConfig;
  }
  /** Configuration for dual screen hinge */
  export interface HingeConfig {
    rect: DOM.Rect;
    contentColor?: DOM.RGBA;
    outlineColor?: DOM.RGBA;
  }
  export interface InspectedElementAnchorConfig {
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
  }
  export type InspectMode = "searchForNode" | "searchForUAShadowDOM" | "captureAreaScreenshot" | "none";
  export interface IsolatedElementHighlightConfig {
    isolationModeHighlightConfig: Overlay.IsolationModeHighlightConfig;
    nodeId: DOM.NodeId;
  }
  export interface IsolationModeHighlightConfig {
    resizerColor?: DOM.RGBA;
    resizerHandleColor?: DOM.RGBA;
    maskColor?: DOM.RGBA;
  }
  /** Style information for drawing a line. */
  export interface LineStyle {
    color?: DOM.RGBA;
    pattern?: "dashed" | "dotted";
  }
  export interface ScrollSnapContainerHighlightConfig {
    snapportBorder?: Overlay.LineStyle;
    snapAreaBorder?: Overlay.LineStyle;
    scrollMarginColor?: DOM.RGBA;
    scrollPaddingColor?: DOM.RGBA;
  }
  export interface ScrollSnapHighlightConfig {
    scrollSnapContainerHighlightConfig: Overlay.ScrollSnapContainerHighlightConfig;
    nodeId: DOM.NodeId;
  }
  /** Configuration data for drawing the source order of an elements children. */
  export interface SourceOrderConfig {
    parentOutlineColor: DOM.RGBA;
    childOutlineColor: DOM.RGBA;
  }
  /** Configuration for Window Controls Overlay */
  export interface WindowControlsOverlayConfig {
    showCSS: boolean;
    selectedPlatform: string;
    themeColor: string;
  }
  /** Disables domain notifications. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables domain notifications. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** For Persistent Grid testing. */
  export interface GetGridHighlightObjectsForTestRequest {
    nodeIds: DOM.NodeId[];
  }
  export interface GetGridHighlightObjectsForTestResponse {
    highlights: Record<string, unknown>;
  }
  /** For testing. */
  export interface GetHighlightObjectForTestRequest {
    nodeId: DOM.NodeId;
    includeDistance?: boolean;
    includeStyle?: boolean;
    colorFormat?: Overlay.ColorFormat;
    showAccessibilityInfo?: boolean;
  }
  export interface GetHighlightObjectForTestResponse {
    highlight: Record<string, unknown>;
  }
  /** For Source Order Viewer testing. */
  export interface GetSourceOrderHighlightObjectForTestRequest {
    nodeId: DOM.NodeId;
  }
  export interface GetSourceOrderHighlightObjectForTestResponse {
    highlight: Record<string, unknown>;
  }
  /** Hides any highlight. */
  export interface HideHighlightRequest {}
  export interface HideHighlightResponse {}
  /**
   * Highlights owner element of the frame with given id.
   * Deprecated: Doesn't work reliably and cannot be fixed due to process
   * separation (the owner node might be in a different process). Determine
   * the owner node in the client and use highlightNode.
   * @deprecated
   */
  export interface HighlightFrameRequest {
    frameId: Page.FrameId;
    contentColor?: DOM.RGBA;
    contentOutlineColor?: DOM.RGBA;
  }
  export interface HighlightFrameResponse {}
  /**
   * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
   * objectId must be specified.
   */
  export interface HighlightNodeRequest {
    highlightConfig: Overlay.HighlightConfig;
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
    selector?: string;
  }
  export interface HighlightNodeResponse {}
  /** Highlights given quad. Coordinates are absolute with respect to the main frame viewport. */
  export interface HighlightQuadRequest {
    quad: DOM.Quad;
    color?: DOM.RGBA;
    outlineColor?: DOM.RGBA;
  }
  export interface HighlightQuadResponse {}
  /**
   * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
   * Issue: the method does not handle device pixel ratio (DPR) correctly.
   * The coordinates currently have to be adjusted by the client
   * if DPR is not 1 (see crbug.com/437807128).
   */
  export interface HighlightRectRequest {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: DOM.RGBA;
    outlineColor?: DOM.RGBA;
  }
  export interface HighlightRectResponse {}
  /**
   * Highlights the source order of the children of the DOM node with given id or with the given
   * JavaScript object wrapper. Either nodeId or objectId must be specified.
   */
  export interface HighlightSourceOrderRequest {
    sourceOrderConfig: Overlay.SourceOrderConfig;
    nodeId?: DOM.NodeId;
    backendNodeId?: DOM.BackendNodeId;
    objectId?: Runtime.RemoteObjectId;
  }
  export interface HighlightSourceOrderResponse {}
  /**
   * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
   * Backend then generates 'inspectNodeRequested' event upon element selection.
   */
  export interface SetInspectModeRequest {
    mode: Overlay.InspectMode;
    highlightConfig?: Overlay.HighlightConfig;
  }
  export interface SetInspectModeResponse {}
  export interface SetPausedInDebuggerMessageRequest {
    message?: string;
  }
  export interface SetPausedInDebuggerMessageResponse {}
  /** Highlights owner element of all frames detected to be ads. */
  export interface SetShowAdHighlightsRequest {
    show: boolean;
  }
  export interface SetShowAdHighlightsResponse {}
  export interface SetShowContainerQueryOverlaysRequest {
    containerQueryHighlightConfigs: Overlay.ContainerQueryHighlightConfig[];
  }
  export interface SetShowContainerQueryOverlaysResponse {}
  /** Requests that backend shows debug borders on layers */
  export interface SetShowDebugBordersRequest {
    show: boolean;
  }
  export interface SetShowDebugBordersResponse {}
  export interface SetShowFlexOverlaysRequest {
    flexNodeHighlightConfigs: Overlay.FlexNodeHighlightConfig[];
  }
  export interface SetShowFlexOverlaysResponse {}
  /** Requests that backend shows the FPS counter */
  export interface SetShowFPSCounterRequest {
    show: boolean;
  }
  export interface SetShowFPSCounterResponse {}
  /** Highlight multiple elements with the CSS Grid overlay. */
  export interface SetShowGridOverlaysRequest {
    gridNodeHighlightConfigs: Overlay.GridNodeHighlightConfig[];
  }
  export interface SetShowGridOverlaysResponse {}
  /** Add a dual screen device hinge */
  export interface SetShowHingeRequest {
    hingeConfig?: Overlay.HingeConfig;
  }
  export interface SetShowHingeResponse {}
  /**
   * Deprecated, no longer has any effect.
   * @deprecated
   */
  export interface SetShowHitTestBordersRequest {
    show: boolean;
  }
  export interface SetShowHitTestBordersResponse {}
  export interface SetShowInspectedElementAnchorRequest {
    inspectedElementAnchorConfig: Overlay.InspectedElementAnchorConfig;
  }
  export interface SetShowInspectedElementAnchorResponse {}
  /** Show elements in isolation mode with overlays. */
  export interface SetShowIsolatedElementsRequest {
    isolatedElementHighlightConfigs: Overlay.IsolatedElementHighlightConfig[];
  }
  export interface SetShowIsolatedElementsResponse {}
  /** Requests that backend shows layout shift regions */
  export interface SetShowLayoutShiftRegionsRequest {
    result: boolean;
  }
  export interface SetShowLayoutShiftRegionsResponse {}
  /** Requests that backend shows paint rectangles */
  export interface SetShowPaintRectsRequest {
    result: boolean;
  }
  export interface SetShowPaintRectsResponse {}
  /** Requests that backend shows scroll bottleneck rects */
  export interface SetShowScrollBottleneckRectsRequest {
    show: boolean;
  }
  export interface SetShowScrollBottleneckRectsResponse {}
  export interface SetShowScrollSnapOverlaysRequest {
    scrollSnapHighlightConfigs: Overlay.ScrollSnapHighlightConfig[];
  }
  export interface SetShowScrollSnapOverlaysResponse {}
  /** Paints viewport size upon main frame resize. */
  export interface SetShowViewportSizeOnResizeRequest {
    show: boolean;
  }
  export interface SetShowViewportSizeOnResizeResponse {}
  /**
   * Deprecated, no longer has any effect.
   * @deprecated
   */
  export interface SetShowWebVitalsRequest {
    show: boolean;
  }
  export interface SetShowWebVitalsResponse {}
  /** Show Window Controls Overlay for PWA */
  export interface SetShowWindowControlsOverlayRequest {
    windowControlsOverlayConfig?: Overlay.WindowControlsOverlayConfig;
  }
  export interface SetShowWindowControlsOverlayResponse {}
  /** Fired when user asks to restore the Inspected Element floating window. */
  export interface InspectedElementWindowRestoredEvent {
    backendNodeId: DOM.BackendNodeId;
  }
  /** Fired when user cancels the inspect mode. */
  export interface InspectModeCanceledEvent {}
  /**
   * Fired when the node should be inspected. This happens after call to `setInspectMode` or when
   * user manually inspects an element.
   */
  export interface InspectNodeRequestedEvent {
    backendNodeId: DOM.BackendNodeId;
  }
  /** Fired when user asks to show the Inspect panel. */
  export interface InspectPanelShowRequestedEvent {
    backendNodeId: DOM.BackendNodeId;
  }
  /** Fired when the node should be highlighted. This happens after call to `setInspectMode`. */
  export interface NodeHighlightRequestedEvent {
    nodeId: DOM.NodeId;
  }
  /** Fired when user asks to capture screenshot of some area on the page. */
  export interface ScreenshotRequestedEvent {
    viewport: Page.Viewport;
  }
}

/**
 * Actions and events related to the inspected page belong to the page domain.
 */
export namespace Page {
  /** @experimental */
  export type AdFrameExplanation = "ParentIsAd" | "CreatedByAdScript" | "MatchedBlockingRule";
  /**
   * Indicates whether a frame has been identified as an ad and why.
   * @experimental
   */
  export interface AdFrameStatus {
    adFrameType: Page.AdFrameType;
    explanations?: Page.AdFrameExplanation[];
  }
  /**
   * Indicates whether a frame has been identified as an ad.
   * @experimental
   */
  export type AdFrameType = "none" | "child" | "root";
  /** Error while paring app manifest. */
  export interface AppManifestError {
    message: string;
    critical: number;
    line: number;
    column: number;
  }
  /**
   * Parsed app manifest properties.
   * @experimental
   */
  export interface AppManifestParsedProperties {
    scope: string;
  }
  /** @experimental */
  export interface BackForwardCacheBlockingDetails {
    url?: string;
    function?: string;
    lineNumber: number;
    columnNumber: number;
  }
  /** @experimental */
  export interface BackForwardCacheNotRestoredExplanation {
    type: Page.BackForwardCacheNotRestoredReasonType;
    reason: Page.BackForwardCacheNotRestoredReason;
    context?: string;
    details?: Page.BackForwardCacheBlockingDetails[];
  }
  /** @experimental */
  export interface BackForwardCacheNotRestoredExplanationTree {
    url: string;
    explanations: Page.BackForwardCacheNotRestoredExplanation[];
    children: Page.BackForwardCacheNotRestoredExplanationTree[];
  }
  /**
   * List of not restored reasons for back-forward cache.
   * @experimental
   */
  export type BackForwardCacheNotRestoredReason = "NotPrimaryMainFrame" | "BackForwardCacheDisabled" | "RelatedActiveContentsExist" | "HTTPStatusNotOK" | "SchemeNotHTTPOrHTTPS" | "Loading" | "WasGrantedMediaAccess" | "DisableForRenderFrameHostCalled" | "DomainNotAllowed" | "HTTPMethodNotGET" | "SubframeIsNavigating" | "Timeout" | "CacheLimit" | "JavaScriptExecution" | "RendererProcessKilled" | "RendererProcessCrashed" | "SchedulerTrackedFeatureUsed" | "ConflictingBrowsingInstance" | "CacheFlushed" | "ServiceWorkerVersionActivation" | "SessionRestored" | "ServiceWorkerPostMessage" | "EnteredBackForwardCacheBeforeServiceWorkerHostAdded" | "RenderFrameHostReused_SameSite" | "RenderFrameHostReused_CrossSite" | "ServiceWorkerClaim" | "IgnoreEventAndEvict" | "HaveInnerContents" | "TimeoutPuttingInCache" | "BackForwardCacheDisabledByLowMemory" | "BackForwardCacheDisabledByCommandLine" | "NetworkRequestDatapipeDrainedAsBytesConsumer" | "NetworkRequestRedirected" | "NetworkRequestTimeout" | "NetworkExceedsBufferLimit" | "NavigationCancelledWhileRestoring" | "NotMostRecentNavigationEntry" | "BackForwardCacheDisabledForPrerender" | "UserAgentOverrideDiffers" | "ForegroundCacheLimit" | "ForwardCacheDisabled" | "BrowsingInstanceNotSwapped" | "BackForwardCacheDisabledForDelegate" | "UnloadHandlerExistsInMainFrame" | "UnloadHandlerExistsInSubFrame" | "ServiceWorkerUnregistration" | "CacheControlNoStore" | "CacheControlNoStoreCookieModified" | "CacheControlNoStoreHTTPOnlyCookieModified" | "NoResponseHead" | "Unknown" | "ActivationNavigationsDisallowedForBug1234857" | "ErrorDocument" | "FencedFramesEmbedder" | "CookieDisabled" | "HTTPAuthRequired" | "CookieFlushed" | "BroadcastChannelOnMessage" | "WebViewSettingsChanged" | "WebViewJavaScriptObjectChanged" | "WebViewMessageListenerInjected" | "WebViewSafeBrowsingAllowlistChanged" | "WebViewDocumentStartJavascriptChanged" | "WebSocket" | "WebTransport" | "WebRTC" | "MainResourceHasCacheControlNoStore" | "MainResourceHasCacheControlNoCache" | "SubresourceHasCacheControlNoStore" | "SubresourceHasCacheControlNoCache" | "ContainsPlugins" | "DocumentLoaded" | "OutstandingNetworkRequestOthers" | "RequestedMIDIPermission" | "RequestedAudioCapturePermission" | "RequestedVideoCapturePermission" | "RequestedBackForwardCacheBlockedSensors" | "RequestedBackgroundWorkPermission" | "BroadcastChannel" | "WebXR" | "SharedWorker" | "SharedWorkerMessage" | "SharedWorkerWithNoActiveClient" | "WebLocks" | "WebLocksContention" | "WebHID" | "WebBluetooth" | "WebShare" | "RequestedStorageAccessGrant" | "WebNfc" | "OutstandingNetworkRequestFetch" | "OutstandingNetworkRequestXHR" | "AppBanner" | "Printing" | "WebDatabase" | "PictureInPicture" | "SpeechRecognizer" | "IdleManager" | "PaymentManager" | "SpeechSynthesis" | "KeyboardLock" | "WebOTPService" | "OutstandingNetworkRequestDirectSocket" | "InjectedJavascript" | "InjectedStyleSheet" | "KeepaliveRequest" | "IndexedDBEvent" | "Dummy" | "JsNetworkRequestReceivedCacheControlNoStoreResource" | "WebRTCUsedWithCCNS" | "WebTransportUsedWithCCNS" | "WebSocketUsedWithCCNS" | "SmartCard" | "LiveMediaStreamTrack" | "UnloadHandler" | "ParserAborted" | "ContentSecurityHandler" | "ContentWebAuthenticationAPI" | "ContentFileChooser" | "ContentSerial" | "ContentFileSystemAccess" | "ContentMediaDevicesDispatcherHost" | "ContentWebBluetooth" | "ContentWebUSB" | "ContentMediaSessionService" | "ContentScreenReader" | "ContentDiscarded" | "EmbedderPopupBlockerTabHelper" | "EmbedderSafeBrowsingTriggeredPopupBlocker" | "EmbedderSafeBrowsingThreatDetails" | "EmbedderAppBannerManager" | "EmbedderDomDistillerViewerSource" | "EmbedderDomDistillerSelfDeletingRequestDelegate" | "EmbedderOomInterventionTabHelper" | "EmbedderOfflinePage" | "EmbedderChromePasswordManagerClientBindCredentialManager" | "EmbedderPermissionRequestManager" | "EmbedderModalDialog" | "EmbedderExtensions" | "EmbedderExtensionMessaging" | "EmbedderExtensionMessagingForOpenPort" | "EmbedderExtensionSentMessageToCachedFrame" | "EmbedderExtensionFrame" | "RequestedByWebViewClient" | "PostMessageByWebViewClient" | "CacheControlNoStoreDeviceBoundSessionTerminated" | "CacheLimitPrunedOnModerateMemoryPressure" | "CacheLimitPrunedOnCriticalMemoryPressure";
  /**
   * Types of not restored reasons for back-forward cache.
   * @experimental
   */
  export type BackForwardCacheNotRestoredReasonType = "SupportPending" | "PageSupportNeeded" | "Circumstantial";
  /** @experimental */
  export type ClientNavigationDisposition = "currentTab" | "newTab" | "newWindow" | "download";
  /** @experimental */
  export type ClientNavigationReason = "anchorClick" | "formSubmissionGet" | "formSubmissionPost" | "httpHeaderRefresh" | "initialFrameNavigation" | "metaTagRefresh" | "other" | "pageBlockInterstitial" | "reload" | "scriptInitiated";
  /**
   * Per-script compilation cache parameters for `Page.produceCompilationCache`
   * @experimental
   */
  export interface CompilationCacheParams {
    url: string;
    eager?: boolean;
  }
  /**
   * Indicates whether the frame is cross-origin isolated and why it is the case.
   * @experimental
   */
  export type CrossOriginIsolatedContextType = "Isolated" | "NotIsolated" | "NotIsolatedFeatureDisabled";
  /** Javascript dialog type. */
  export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";
  /** @experimental */
  export interface FileFilter {
    name?: string;
    accepts?: string[];
  }
  /** @experimental */
  export interface FileHandler {
    action: string;
    name: string;
    icons?: Page.ImageResource[];
    accepts?: Page.FileFilter[];
    launchType: string;
  }
  /**
   * Generic font families collection.
   * @experimental
   */
  export interface FontFamilies {
    standard?: string;
    fixed?: string;
    serif?: string;
    sansSerif?: string;
    cursive?: string;
    fantasy?: string;
    math?: string;
  }
  /**
   * Default font sizes.
   * @experimental
   */
  export interface FontSizes {
    standard?: number;
    fixed?: number;
  }
  /** Information about the Frame on the page. */
  export interface Frame {
    id: Page.FrameId;
    parentId?: Page.FrameId;
    loaderId: Network.LoaderId;
    name?: string;
    url: string;
    urlFragment?: string;
    domainAndRegistry: string;
    securityOrigin: string;
    securityOriginDetails?: Page.SecurityOriginDetails;
    mimeType: string;
    unreachableUrl?: string;
    adFrameStatus?: Page.AdFrameStatus;
    secureContextType: Page.SecureContextType;
    crossOriginIsolatedContextType: Page.CrossOriginIsolatedContextType;
    gatedAPIFeatures: Page.GatedAPIFeatures[];
  }
  /** Unique frame identifier. */
  export type FrameId = string;
  /**
   * Information about the Resource on the page.
   * @experimental
   */
  export interface FrameResource {
    url: string;
    type: Network.ResourceType;
    mimeType: string;
    lastModified?: Network.TimeSinceEpoch;
    contentSize?: number;
    failed?: boolean;
    canceled?: boolean;
  }
  /**
   * Information about the Frame hierarchy along with their cached resources.
   * @experimental
   */
  export interface FrameResourceTree {
    frame: Page.Frame;
    childFrames?: Page.FrameResourceTree[];
    resources: Page.FrameResource[];
  }
  /** Information about the Frame hierarchy. */
  export interface FrameTree {
    frame: Page.Frame;
    childFrames?: Page.FrameTree[];
  }
  /** @experimental */
  export type GatedAPIFeatures = "SharedArrayBuffers" | "SharedArrayBuffersTransferAllowed" | "PerformanceMeasureMemory" | "PerformanceProfile";
  /**
   * The image definition used in both icon and screenshot.
   * @experimental
   */
  export interface ImageResource {
    url: string;
    sizes?: string;
    type?: string;
  }
  /**
   * The installability error
   * @experimental
   */
  export interface InstallabilityError {
    errorId: string;
    errorArguments: Page.InstallabilityErrorArgument[];
  }
  /** @experimental */
  export interface InstallabilityErrorArgument {
    name: string;
    value: string;
  }
  /** @experimental */
  export interface LaunchHandler {
    clientMode: string;
  }
  /** Layout viewport position and dimensions. */
  export interface LayoutViewport {
    pageX: number;
    pageY: number;
    clientWidth: number;
    clientHeight: number;
  }
  /** Navigation history entry. */
  export interface NavigationEntry {
    id: number;
    url: string;
    userTypedURL: string;
    title: string;
    transitionType: Page.TransitionType;
  }
  /**
   * The type of a frameNavigated event.
   * @experimental
   */
  export type NavigationType = "Navigation" | "BackForwardCacheRestore";
  /** @experimental */
  export interface OriginTrial {
    trialName: string;
    status: Page.OriginTrialStatus;
    tokensWithStatus: Page.OriginTrialTokenWithStatus[];
  }
  /**
   * Status for an Origin Trial.
   * @experimental
   */
  export type OriginTrialStatus = "Enabled" | "ValidTokenNotProvided" | "OSNotSupported" | "TrialNotAllowed";
  /** @experimental */
  export interface OriginTrialToken {
    origin: string;
    matchSubDomains: boolean;
    trialName: string;
    expiryTime: Network.TimeSinceEpoch;
    isThirdParty: boolean;
    usageRestriction: Page.OriginTrialUsageRestriction;
  }
  /**
   * Origin Trial(https://www.chromium.org/blink/origin-trials) support.
   * Status for an Origin Trial token.
   * @experimental
   */
  export type OriginTrialTokenStatus = "Success" | "NotSupported" | "Insecure" | "Expired" | "WrongOrigin" | "InvalidSignature" | "Malformed" | "WrongVersion" | "FeatureDisabled" | "TokenDisabled" | "FeatureDisabledForUser" | "UnknownTrial";
  /** @experimental */
  export interface OriginTrialTokenWithStatus {
    rawTokenText: string;
    parsedToken?: Page.OriginTrialToken;
    status: Page.OriginTrialTokenStatus;
  }
  /** @experimental */
  export type OriginTrialUsageRestriction = "None" | "Subset";
  /** @experimental */
  export interface PermissionsPolicyBlockLocator {
    frameId: Page.FrameId;
    blockReason: Page.PermissionsPolicyBlockReason;
  }
  /**
   * Reason for a permissions policy feature to be disabled.
   * @experimental
   */
  export type PermissionsPolicyBlockReason = "Header" | "IframeAttribute" | "InFencedFrameTree" | "InIsolatedApp";
  /**
   * All Permissions Policy features. This enum should match the one defined
   * in services/network/public/cpp/permissions_policy/permissions_policy_features.json5.
   * LINT.IfChange(PermissionsPolicyFeature)
   * @experimental
   */
  export type PermissionsPolicyFeature = "accelerometer" | "all-screens-capture" | "ambient-light-sensor" | "aria-notify" | "attribution-reporting" | "autofill" | "autoplay" | "bluetooth" | "browsing-topics" | "camera" | "captured-surface-control" | "ch-dpr" | "ch-device-memory" | "ch-downlink" | "ch-ect" | "ch-prefers-color-scheme" | "ch-prefers-reduced-motion" | "ch-prefers-reduced-transparency" | "ch-rtt" | "ch-save-data" | "ch-ua" | "ch-ua-arch" | "ch-ua-bitness" | "ch-ua-high-entropy-values" | "ch-ua-platform" | "ch-ua-model" | "ch-ua-mobile" | "ch-ua-form-factors" | "ch-ua-full-version" | "ch-ua-full-version-list" | "ch-ua-platform-version" | "ch-ua-wow64" | "ch-viewport-height" | "ch-viewport-width" | "ch-width" | "clipboard-read" | "clipboard-write" | "compute-pressure" | "controlled-frame" | "cross-origin-isolated" | "deferred-fetch" | "deferred-fetch-minimal" | "device-attributes" | "digital-credentials-create" | "digital-credentials-get" | "direct-sockets" | "direct-sockets-multicast" | "direct-sockets-private" | "display-capture" | "document-domain" | "encrypted-media" | "execution-while-out-of-viewport" | "execution-while-not-rendered" | "focus-without-user-activation" | "fullscreen" | "frobulate" | "gamepad" | "geolocation" | "gyroscope" | "hid" | "identity-credentials-get" | "idle-detection" | "interest-cohort" | "join-ad-interest-group" | "keyboard-map" | "language-detector" | "language-model" | "local-fonts" | "local-network" | "local-network-access" | "loopback-network" | "magnetometer" | "manual-text" | "media-playback-while-not-visible" | "microphone" | "midi" | "on-device-speech-recognition" | "otp-credentials" | "payment" | "picture-in-picture" | "private-aggregation" | "private-state-token-issuance" | "private-state-token-redemption" | "publickey-credentials-create" | "publickey-credentials-get" | "record-ad-auction-events" | "rewriter" | "run-ad-auction" | "screen-wake-lock" | "serial" | "shared-storage" | "shared-storage-select-url" | "smart-card" | "speaker-selection" | "storage-access" | "sub-apps" | "summarizer" | "sync-xhr" | "translator" | "unload" | "usb" | "usb-unrestricted" | "vertical-scroll" | "web-app-installation" | "web-printing" | "web-share" | "window-management" | "writer" | "xr-spatial-tracking";
  /** @experimental */
  export interface PermissionsPolicyFeatureState {
    feature: Page.PermissionsPolicyFeature;
    allowed: boolean;
    locator?: Page.PermissionsPolicyBlockLocator;
  }
  /** @experimental */
  export interface ProtocolHandler {
    protocol: string;
    url: string;
  }
  /**
   * The referring-policy used for the navigation.
   * @experimental
   */
  export type ReferrerPolicy = "noReferrer" | "noReferrerWhenDowngrade" | "origin" | "originWhenCrossOrigin" | "sameOrigin" | "strictOrigin" | "strictOriginWhenCrossOrigin" | "unsafeUrl";
  /** @experimental */
  export interface RelatedApplication {
    id?: string;
    url: string;
  }
  /** @experimental */
  export interface ScopeExtension {
    origin: string;
    hasOriginWildcard: boolean;
  }
  /**
   * Screencast frame metadata.
   * @experimental
   */
  export interface ScreencastFrameMetadata {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: Network.TimeSinceEpoch;
  }
  /** @experimental */
  export interface Screenshot {
    image: Page.ImageResource;
    formFactor: string;
    label?: string;
  }
  /**
   * Font families collection for a script.
   * @experimental
   */
  export interface ScriptFontFamilies {
    script: string;
    fontFamilies: Page.FontFamilies;
  }
  /** Unique script identifier. */
  export type ScriptIdentifier = string;
  /**
   * Indicates whether the frame is a secure context and why it is the case.
   * @experimental
   */
  export type SecureContextType = "Secure" | "SecureLocalhost" | "InsecureScheme" | "InsecureAncestor";
  /**
   * Additional information about the frame document's security origin.
   * @experimental
   */
  export interface SecurityOriginDetails {
    isLocalhost: boolean;
  }
  /** @experimental */
  export interface ShareTarget {
    action: string;
    method: string;
    enctype: string;
    title?: string;
    text?: string;
    url?: string;
    files?: Page.FileFilter[];
  }
  /** @experimental */
  export interface Shortcut {
    name: string;
    url: string;
  }
  /** Transition type. */
  export type TransitionType = "link" | "typed" | "address_bar" | "auto_bookmark" | "auto_subframe" | "manual_subframe" | "generated" | "auto_toplevel" | "form_submit" | "reload" | "keyword" | "keyword_generated" | "other";
  /** Viewport for capturing screenshot. */
  export interface Viewport {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  }
  /** Visual viewport position, dimensions, and scale. */
  export interface VisualViewport {
    offsetX: number;
    offsetY: number;
    pageX: number;
    pageY: number;
    clientWidth: number;
    clientHeight: number;
    scale: number;
    zoom?: number;
  }
  /** @experimental */
  export interface WebAppManifest {
    backgroundColor?: string;
    description?: string;
    dir?: string;
    display?: string;
    displayOverrides?: string[];
    fileHandlers?: Page.FileHandler[];
    icons?: Page.ImageResource[];
    id?: string;
    lang?: string;
    launchHandler?: Page.LaunchHandler;
    name?: string;
    orientation?: string;
    preferRelatedApplications?: boolean;
    protocolHandlers?: Page.ProtocolHandler[];
    relatedApplications?: Page.RelatedApplication[];
    scope?: string;
    scopeExtensions?: Page.ScopeExtension[];
    screenshots?: Page.Screenshot[];
    shareTarget?: Page.ShareTarget;
    shortName?: string;
    shortcuts?: Page.Shortcut[];
    startUrl?: string;
    themeColor?: string;
  }
  /**
   * Seeds compilation cache for given url. Compilation cache does not survive
   * cross-process navigation.
   * @experimental
   */
  export interface AddCompilationCacheRequest {
    url: string;
    data: string;
  }
  export interface AddCompilationCacheResponse {}
  /**
   * Deprecated, please use addScriptToEvaluateOnNewDocument instead.
   * @experimental
   * @deprecated
   */
  export interface AddScriptToEvaluateOnLoadRequest {
    scriptSource: string;
  }
  export interface AddScriptToEvaluateOnLoadResponse {
    identifier: Page.ScriptIdentifier;
  }
  /** Evaluates given script in every frame upon creation (before loading frame's scripts). */
  export interface AddScriptToEvaluateOnNewDocumentRequest {
    source: string;
    worldName?: string;
    includeCommandLineAPI?: boolean;
    runImmediately?: boolean;
  }
  export interface AddScriptToEvaluateOnNewDocumentResponse {
    identifier: Page.ScriptIdentifier;
  }
  /** Brings page to front (activates tab). */
  export interface BringToFrontRequest {}
  export interface BringToFrontResponse {}
  /** Capture page screenshot. */
  export interface CaptureScreenshotRequest {
    format?: "jpeg" | "png" | "webp";
    quality?: number;
    clip?: Page.Viewport;
    fromSurface?: boolean;
    captureBeyondViewport?: boolean;
    optimizeForSpeed?: boolean;
  }
  export interface CaptureScreenshotResponse {
    data: string;
  }
  /**
   * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
   * iframes, shadow DOM, external resources, and element-inline styles.
   * @experimental
   */
  export interface CaptureSnapshotRequest {
    format?: "mhtml";
  }
  export interface CaptureSnapshotResponse {
    data: string;
  }
  /**
   * Clears seeded compilation cache.
   * @experimental
   */
  export interface ClearCompilationCacheRequest {}
  export interface ClearCompilationCacheResponse {}
  /** Tries to close page, running its beforeunload hooks, if any. */
  export interface CloseRequest {}
  export interface CloseResponse {}
  /**
   * Crashes renderer on the IO thread, generates minidumps.
   * @experimental
   */
  export interface CrashRequest {}
  export interface CrashResponse {}
  /** Creates an isolated world for the given frame. */
  export interface CreateIsolatedWorldRequest {
    frameId: Page.FrameId;
    worldName?: string;
    grantUniveralAccess?: boolean;
  }
  export interface CreateIsolatedWorldResponse {
    executionContextId: Runtime.ExecutionContextId;
  }
  /** Disables page domain notifications. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables page domain notifications. */
  export interface EnableRequest {
    enableFileChooserOpenedEvent?: boolean;
  }
  export interface EnableResponse {}
  /**
   * Generates a report for testing.
   * @experimental
   */
  export interface GenerateTestReportRequest {
    message: string;
    group?: string;
  }
  export interface GenerateTestReportResponse {}
  /** @experimental */
  export interface GetAdScriptAncestryRequest {
    frameId: Page.FrameId;
  }
  export interface GetAdScriptAncestryResponse {
    adScriptAncestry?: Network.AdAncestry;
  }
  /**
   * Get the annotated page content for the main frame.
   * This is an experimental command that is subject to change.
   * @experimental
   */
  export interface GetAnnotatedPageContentRequest {
    includeActionableInformation?: boolean;
  }
  export interface GetAnnotatedPageContentResponse {
    content: string;
  }
  /**
   * Returns the unique (PWA) app id.
   * Only returns values if the feature flag 'WebAppEnableManifestId' is enabled
   * @experimental
   */
  export interface GetAppIdRequest {}
  export interface GetAppIdResponse {
    appId?: string;
    recommendedId?: string;
  }
  /**
   * Gets the processed manifest for this current document.
   *   This API always waits for the manifest to be loaded.
   *   If manifestId is provided, and it does not match the manifest of the
   *     current document, this API errors out.
   *   If there is not a loaded page, this API errors out immediately.
   */
  export interface GetAppManifestRequest {
    manifestId?: string;
  }
  export interface GetAppManifestResponse {
    url: string;
    errors: Page.AppManifestError[];
    data?: string;
    parsed?: Page.AppManifestParsedProperties;
    manifest: Page.WebAppManifest;
  }
  /** Returns present frame tree structure. */
  export interface GetFrameTreeRequest {}
  export interface GetFrameTreeResponse {
    frameTree: Page.FrameTree;
  }
  /** @experimental */
  export interface GetInstallabilityErrorsRequest {}
  export interface GetInstallabilityErrorsResponse {
    installabilityErrors: Page.InstallabilityError[];
  }
  /** Returns metrics relating to the layouting of the page, such as viewport bounds/scale. */
  export interface GetLayoutMetricsRequest {}
  export interface GetLayoutMetricsResponse {
    layoutViewport: Page.LayoutViewport;
    visualViewport: Page.VisualViewport;
    contentSize: DOM.Rect;
    cssLayoutViewport: Page.LayoutViewport;
    cssVisualViewport: Page.VisualViewport;
    cssContentSize: DOM.Rect;
  }
  /**
   * Deprecated because it's not guaranteed that the returned icon is in fact the one used for PWA installation.
   * @experimental
   * @deprecated
   */
  export interface GetManifestIconsRequest {}
  export interface GetManifestIconsResponse {
    primaryIcon?: string;
  }
  /** Returns navigation history for the current page. */
  export interface GetNavigationHistoryRequest {}
  export interface GetNavigationHistoryResponse {
    currentIndex: number;
    entries: Page.NavigationEntry[];
  }
  /**
   * Get Origin Trials on given frame.
   * @experimental
   */
  export interface GetOriginTrialsRequest {
    frameId: Page.FrameId;
  }
  export interface GetOriginTrialsResponse {
    originTrials: Page.OriginTrial[];
  }
  /**
   * Get Permissions Policy state on given frame.
   * @experimental
   */
  export interface GetPermissionsPolicyStateRequest {
    frameId: Page.FrameId;
  }
  export interface GetPermissionsPolicyStateResponse {
    states: Page.PermissionsPolicyFeatureState[];
  }
  /**
   * Returns content of the given resource.
   * @experimental
   */
  export interface GetResourceContentRequest {
    frameId: Page.FrameId;
    url: string;
  }
  export interface GetResourceContentResponse {
    content: string;
    base64Encoded: boolean;
  }
  /**
   * Returns present frame / resource tree structure.
   * @experimental
   */
  export interface GetResourceTreeRequest {}
  export interface GetResourceTreeResponse {
    frameTree: Page.FrameResourceTree;
  }
  /** Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload). */
  export interface HandleJavaScriptDialogRequest {
    accept: boolean;
    promptText?: string;
  }
  export interface HandleJavaScriptDialogResponse {}
  /** Navigates current page to the given URL. */
  export interface NavigateRequest {
    url: string;
    referrer?: string;
    transitionType?: Page.TransitionType;
    frameId?: Page.FrameId;
    referrerPolicy?: Page.ReferrerPolicy;
  }
  export interface NavigateResponse {
    frameId: Page.FrameId;
    loaderId?: Network.LoaderId;
    errorText?: string;
    isDownload?: boolean;
  }
  /** Navigates current page to the given history entry. */
  export interface NavigateToHistoryEntryRequest {
    entryId: number;
  }
  export interface NavigateToHistoryEntryResponse {}
  /** Print page as PDF. */
  export interface PrintToPDFRequest {
    landscape?: boolean;
    displayHeaderFooter?: boolean;
    printBackground?: boolean;
    scale?: number;
    paperWidth?: number;
    paperHeight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    pageRanges?: string;
    headerTemplate?: string;
    footerTemplate?: string;
    preferCSSPageSize?: boolean;
    transferMode?: "ReturnAsBase64" | "ReturnAsStream";
    generateTaggedPDF?: boolean;
    generateDocumentOutline?: boolean;
  }
  export interface PrintToPDFResponse {
    data: string;
    stream?: IO.StreamHandle;
  }
  /**
   * Requests backend to produce compilation cache for the specified scripts.
   * `scripts` are appended to the list of scripts for which the cache
   * would be produced. The list may be reset during page navigation.
   * When script with a matching URL is encountered, the cache is optionally
   * produced upon backend discretion, based on internal heuristics.
   * See also: `Page.compilationCacheProduced`.
   * @experimental
   */
  export interface ProduceCompilationCacheRequest {
    scripts: Page.CompilationCacheParams[];
  }
  export interface ProduceCompilationCacheResponse {}
  /** Reloads given page optionally ignoring the cache. */
  export interface ReloadRequest {
    ignoreCache?: boolean;
    scriptToEvaluateOnLoad?: string;
    loaderId?: Network.LoaderId;
  }
  export interface ReloadResponse {}
  /**
   * Deprecated, please use removeScriptToEvaluateOnNewDocument instead.
   * @experimental
   * @deprecated
   */
  export interface RemoveScriptToEvaluateOnLoadRequest {
    identifier: Page.ScriptIdentifier;
  }
  export interface RemoveScriptToEvaluateOnLoadResponse {}
  /** Removes given script from the list. */
  export interface RemoveScriptToEvaluateOnNewDocumentRequest {
    identifier: Page.ScriptIdentifier;
  }
  export interface RemoveScriptToEvaluateOnNewDocumentResponse {}
  /** Resets navigation history for the current page. */
  export interface ResetNavigationHistoryRequest {}
  export interface ResetNavigationHistoryResponse {}
  /**
   * Acknowledges that a screencast frame has been received by the frontend.
   * @experimental
   */
  export interface ScreencastFrameAckRequest {
    sessionId: number;
  }
  export interface ScreencastFrameAckResponse {}
  /**
   * Searches for given string in resource content.
   * @experimental
   */
  export interface SearchInResourceRequest {
    frameId: Page.FrameId;
    url: string;
    query: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
  }
  export interface SearchInResourceResponse {
    result: Debugger.SearchMatch[];
  }
  /**
   * Enable Chrome's experimental ad filter on all sites.
   * @experimental
   */
  export interface SetAdBlockingEnabledRequest {
    enabled: boolean;
  }
  export interface SetAdBlockingEnabledResponse {}
  /** Enable page Content Security Policy by-passing. */
  export interface SetBypassCSPRequest {
    enabled: boolean;
  }
  export interface SetBypassCSPResponse {}
  /** Sets given markup as the document's HTML. */
  export interface SetDocumentContentRequest {
    frameId: Page.FrameId;
    html: string;
  }
  export interface SetDocumentContentResponse {}
  /**
   * Set the behavior when downloading a file.
   * @experimental
   * @deprecated
   */
  export interface SetDownloadBehaviorRequest {
    behavior: "deny" | "allow" | "default";
    downloadPath?: string;
  }
  export interface SetDownloadBehaviorResponse {}
  /**
   * Set generic font families.
   * @experimental
   */
  export interface SetFontFamiliesRequest {
    fontFamilies: Page.FontFamilies;
    forScripts?: Page.ScriptFontFamilies[];
  }
  export interface SetFontFamiliesResponse {}
  /**
   * Set default font sizes.
   * @experimental
   */
  export interface SetFontSizesRequest {
    fontSizes: Page.FontSizes;
  }
  export interface SetFontSizesResponse {}
  /**
   * Intercept file chooser requests and transfer control to protocol clients.
   * When file chooser interception is enabled, native file chooser dialog is not shown.
   * Instead, a protocol event `Page.fileChooserOpened` is emitted.
   */
  export interface SetInterceptFileChooserDialogRequest {
    enabled: boolean;
    cancel?: boolean;
  }
  export interface SetInterceptFileChooserDialogResponse {}
  /** Controls whether page will emit lifecycle events. */
  export interface SetLifecycleEventsEnabledRequest {
    enabled: boolean;
  }
  export interface SetLifecycleEventsEnabledResponse {}
  /**
   * Enable/disable prerendering manually.
   * 
   * This command is a short-term solution for https://crbug.com/1440085.
   * See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
   * for more details.
   * 
   * TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.
   * @experimental
   */
  export interface SetPrerenderingAllowedRequest {
    isAllowed: boolean;
  }
  export interface SetPrerenderingAllowedResponse {}
  /**
   * Extensions for Custom Handlers API:
   * https://html.spec.whatwg.org/multipage/system-state.html#rph-automation
   * @experimental
   */
  export interface SetRPHRegistrationModeRequest {
    mode: "none" | "autoAccept" | "autoReject";
  }
  export interface SetRPHRegistrationModeResponse {}
  /**
   * Sets the Secure Payment Confirmation transaction mode.
   * https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode
   * @experimental
   */
  export interface SetSPCTransactionModeRequest {
    mode: "none" | "autoAccept" | "autoChooseToAuthAnotherWay" | "autoReject" | "autoOptOut";
  }
  export interface SetSPCTransactionModeResponse {}
  /**
   * Tries to update the web lifecycle state of the page.
   * It will transition the page to the given state according to:
   * https://github.com/WICG/web-lifecycle/
   * @experimental
   */
  export interface SetWebLifecycleStateRequest {
    state: "frozen" | "active";
  }
  export interface SetWebLifecycleStateResponse {}
  /**
   * Starts sending each frame using the `screencastFrame` event.
   * @experimental
   */
  export interface StartScreencastRequest {
    format?: "jpeg" | "png";
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    everyNthFrame?: number;
  }
  export interface StartScreencastResponse {}
  /** Force the page stop all navigations and pending resource fetches. */
  export interface StopLoadingRequest {}
  export interface StopLoadingResponse {}
  /**
   * Stops sending each frame in the `screencastFrame`.
   * @experimental
   */
  export interface StopScreencastRequest {}
  export interface StopScreencastResponse {}
  /**
   * Pauses page execution. Can be resumed using generic Runtime.runIfWaitingForDebugger.
   * @experimental
   */
  export interface WaitForDebuggerRequest {}
  export interface WaitForDebuggerResponse {}
  /**
   * Fired for failed bfcache history navigations if BackForwardCache feature is enabled. Do
   * not assume any ordering with the Page.frameNavigated event. This event is fired only for
   * main-frame history navigation where the document changes (non-same-document navigations),
   * when bfcache navigation fails.
   * @experimental
   */
  export interface BackForwardCacheNotUsedEvent {
    loaderId: Network.LoaderId;
    frameId: Page.FrameId;
    notRestoredExplanations: Page.BackForwardCacheNotRestoredExplanation[];
    notRestoredExplanationsTree?: Page.BackForwardCacheNotRestoredExplanationTree;
  }
  /**
   * Issued for every compilation cache generated.
   * @experimental
   */
  export interface CompilationCacheProducedEvent {
    url: string;
    data: string;
  }
  /**
   * Fired when opening document to write to.
   * @experimental
   */
  export interface DocumentOpenedEvent {
    frame: Page.Frame;
  }
  export interface DomContentEventFiredEvent {
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when download makes progress. Last call has |done| == true.
   * Deprecated. Use Browser.downloadProgress instead.
   * @experimental
   * @deprecated
   */
  export interface DownloadProgressEvent {
    guid: string;
    totalBytes: number;
    receivedBytes: number;
    state: "inProgress" | "completed" | "canceled";
  }
  /**
   * Fired when page is about to start a download.
   * Deprecated. Use Browser.downloadWillBegin instead.
   * @experimental
   * @deprecated
   */
  export interface DownloadWillBeginEvent {
    frameId: Page.FrameId;
    guid: string;
    url: string;
    suggestedFilename: string;
  }
  /** Emitted only when `page.interceptFileChooser` is enabled. */
  export interface FileChooserOpenedEvent {
    frameId: Page.FrameId;
    mode: "selectSingle" | "selectMultiple";
    backendNodeId?: DOM.BackendNodeId;
  }
  /** Fired when frame has been attached to its parent. */
  export interface FrameAttachedEvent {
    frameId: Page.FrameId;
    parentFrameId: Page.FrameId;
    stack?: Runtime.StackTrace;
  }
  /**
   * Fired when frame no longer has a scheduled navigation.
   * @deprecated
   */
  export interface FrameClearedScheduledNavigationEvent {
    frameId: Page.FrameId;
  }
  /** Fired when frame has been detached from its parent. */
  export interface FrameDetachedEvent {
    frameId: Page.FrameId;
    reason: "remove" | "swap";
  }
  /** Fired once navigation of the frame has completed. Frame is now associated with the new loader. */
  export interface FrameNavigatedEvent {
    frame: Page.Frame;
    type: Page.NavigationType;
  }
  /**
   * Fired when a renderer-initiated navigation is requested.
   * Navigation may still be cancelled after the event is issued.
   * @experimental
   */
  export interface FrameRequestedNavigationEvent {
    frameId: Page.FrameId;
    reason: Page.ClientNavigationReason;
    url: string;
    disposition: Page.ClientNavigationDisposition;
  }
  /** @experimental */
  export interface FrameResizedEvent {}
  /**
   * Fired when frame schedules a potential navigation.
   * @deprecated
   */
  export interface FrameScheduledNavigationEvent {
    frameId: Page.FrameId;
    delay: number;
    reason: Page.ClientNavigationReason;
    url: string;
  }
  /**
   * Fired when frame has started loading.
   * @experimental
   */
  export interface FrameStartedLoadingEvent {
    frameId: Page.FrameId;
  }
  /**
   * Fired when a navigation starts. This event is fired for both
   * renderer-initiated and browser-initiated navigations. For renderer-initiated
   * navigations, the event is fired after `frameRequestedNavigation`.
   * Navigation may still be cancelled after the event is issued. Multiple events
   * can be fired for a single navigation, for example, when a same-document
   * navigation becomes a cross-document navigation (such as in the case of a
   * frameset).
   * @experimental
   */
  export interface FrameStartedNavigatingEvent {
    frameId: Page.FrameId;
    url: string;
    loaderId: Network.LoaderId;
    navigationType: "reload" | "reloadBypassingCache" | "restore" | "restoreWithPost" | "historySameDocument" | "historyDifferentDocument" | "sameDocument" | "differentDocument";
  }
  /**
   * Fired when frame has stopped loading.
   * @experimental
   */
  export interface FrameStoppedLoadingEvent {
    frameId: Page.FrameId;
  }
  /**
   * Fired before frame subtree is detached. Emitted before any frame of the
   * subtree is actually detached.
   * @experimental
   */
  export interface FrameSubtreeWillBeDetachedEvent {
    frameId: Page.FrameId;
  }
  /** Fired when interstitial page was hidden */
  export interface InterstitialHiddenEvent {}
  /** Fired when interstitial page was shown */
  export interface InterstitialShownEvent {}
  /**
   * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been
   * closed.
   */
  export interface JavascriptDialogClosedEvent {
    frameId: Page.FrameId;
    result: boolean;
    userInput: string;
  }
  /**
   * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to
   * open.
   */
  export interface JavascriptDialogOpeningEvent {
    url: string;
    frameId: Page.FrameId;
    message: string;
    type: Page.DialogType;
    hasBrowserHandler: boolean;
    defaultPrompt?: string;
  }
  /**
   * Fired for lifecycle events (navigation, load, paint, etc) in the current
   * target (including local frames).
   */
  export interface LifecycleEventEvent {
    frameId: Page.FrameId;
    loaderId: Network.LoaderId;
    name: string;
    timestamp: Network.MonotonicTime;
  }
  export interface LoadEventFiredEvent {
    timestamp: Network.MonotonicTime;
  }
  /**
   * Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.
   * @experimental
   */
  export interface NavigatedWithinDocumentEvent {
    frameId: Page.FrameId;
    url: string;
    navigationType: "fragment" | "historyApi" | "other";
  }
  /**
   * Compressed image data requested by the `startScreencast`.
   * @experimental
   */
  export interface ScreencastFrameEvent {
    data: string;
    metadata: Page.ScreencastFrameMetadata;
    sessionId: number;
  }
  /**
   * Fired when the page with currently enabled screencast was shown or hidden `.
   * @experimental
   */
  export interface ScreencastVisibilityChangedEvent {
    visible: boolean;
  }
  /**
   * Fired when a new window is going to be opened, via window.open(), link click, form submission,
   * etc.
   */
  export interface WindowOpenEvent {
    url: string;
    windowName: string;
    windowFeatures: string[];
    userGesture: boolean;
  }
}

export namespace Performance {
  /** Run-time execution metric. */
  export interface Metric {
    name: string;
    value: number;
  }
  /** Disable collecting and reporting metrics. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enable collecting and reporting metrics. */
  export interface EnableRequest {
    timeDomain?: "timeTicks" | "threadTicks";
  }
  export interface EnableResponse {}
  /** Retrieve current values of run-time metrics. */
  export interface GetMetricsRequest {}
  export interface GetMetricsResponse {
    metrics: Performance.Metric[];
  }
  /**
   * Sets time domain to use for collecting and reporting duration metrics.
   * Note that this must be called before enabling metrics collection. Calling
   * this method while metrics collection is enabled returns an error.
   * @experimental
   * @deprecated
   */
  export interface SetTimeDomainRequest {
    timeDomain: "timeTicks" | "threadTicks";
  }
  export interface SetTimeDomainResponse {}
  /** Current values of the metrics. */
  export interface MetricsEvent {
    metrics: Performance.Metric[];
    title: string;
  }
}

/**
 * Reporting of performance timeline events, as specified in
https://w3c.github.io/performance-timeline/#dom-performanceobserver.
 * @experimental
 */
export namespace PerformanceTimeline {
  /** See https://github.com/WICG/LargestContentfulPaint and largest_contentful_paint.idl */
  export interface LargestContentfulPaint {
    renderTime: Network.TimeSinceEpoch;
    loadTime: Network.TimeSinceEpoch;
    size: number;
    elementId?: string;
    url?: string;
    nodeId?: DOM.BackendNodeId;
  }
  /** See https://wicg.github.io/layout-instability/#sec-layout-shift and layout_shift.idl */
  export interface LayoutShift {
    value: number;
    hadRecentInput: boolean;
    lastInputTime: Network.TimeSinceEpoch;
    sources: PerformanceTimeline.LayoutShiftAttribution[];
  }
  export interface LayoutShiftAttribution {
    previousRect: DOM.Rect;
    currentRect: DOM.Rect;
    nodeId?: DOM.BackendNodeId;
  }
  export interface TimelineEvent {
    frameId: Page.FrameId;
    type: string;
    name: string;
    time: Network.TimeSinceEpoch;
    duration?: number;
    lcpDetails?: PerformanceTimeline.LargestContentfulPaint;
    layoutShiftDetails?: PerformanceTimeline.LayoutShift;
  }
  /**
   * Previously buffered events would be reported before method returns.
   * See also: timelineEventAdded
   */
  export interface EnableRequest {
    eventTypes: string[];
  }
  export interface EnableResponse {}
  /** Sent when a performance timeline event is added. See reportPerformanceTimeline method. */
  export interface TimelineEventAddedEvent {
    event: PerformanceTimeline.TimelineEvent;
  }
}

/**
 * Preload
 * @experimental
 */
export namespace Preload {
  /**
   * TODO(https://crbug.com/1384419): revisit the list of PrefetchStatus and
   * filter out the ones that aren't necessary to the developers.
   */
  export type PrefetchStatus = "PrefetchAllowed" | "PrefetchFailedIneligibleRedirect" | "PrefetchFailedInvalidRedirect" | "PrefetchFailedMIMENotSupported" | "PrefetchFailedNetError" | "PrefetchFailedNon2XX" | "PrefetchEvictedAfterBrowsingDataRemoved" | "PrefetchEvictedAfterCandidateRemoved" | "PrefetchEvictedForNewerPrefetch" | "PrefetchHeldback" | "PrefetchIneligibleRetryAfter" | "PrefetchIsPrivacyDecoy" | "PrefetchIsStale" | "PrefetchNotEligibleBrowserContextOffTheRecord" | "PrefetchNotEligibleDataSaverEnabled" | "PrefetchNotEligibleExistingProxy" | "PrefetchNotEligibleHostIsNonUnique" | "PrefetchNotEligibleNonDefaultStoragePartition" | "PrefetchNotEligibleSameSiteCrossOriginPrefetchRequiredProxy" | "PrefetchNotEligibleSchemeIsNotHttps" | "PrefetchNotEligibleUserHasCookies" | "PrefetchNotEligibleUserHasServiceWorker" | "PrefetchNotEligibleUserHasServiceWorkerNoFetchHandler" | "PrefetchNotEligibleRedirectFromServiceWorker" | "PrefetchNotEligibleRedirectToServiceWorker" | "PrefetchNotEligibleBatterySaverEnabled" | "PrefetchNotEligiblePreloadingDisabled" | "PrefetchNotFinishedInTime" | "PrefetchNotStarted" | "PrefetchNotUsedCookiesChanged" | "PrefetchProxyNotAvailable" | "PrefetchResponseUsed" | "PrefetchSuccessfulButNotUsed" | "PrefetchNotUsedProbeFailed";
  /**
   * A key that identifies a preloading attempt.
   * 
   * The url used is the url specified by the trigger (i.e. the initial URL), and
   * not the final url that is navigated to. For example, prerendering allows
   * same-origin main frame navigations during the attempt, but the attempt is
   * still keyed with the initial URL.
   */
  export interface PreloadingAttemptKey {
    loaderId: Network.LoaderId;
    action: Preload.SpeculationAction;
    url: string;
    formSubmission?: boolean;
    targetHint?: Preload.SpeculationTargetHint;
  }
  /**
   * Lists sources for a preloading attempt, specifically the ids of rule sets
   * that had a speculation rule that triggered the attempt, and the
   * BackendNodeIds of <a href> or <area href> elements that triggered the
   * attempt (in the case of attempts triggered by a document rule). It is
   * possible for multiple rule sets and links to trigger a single attempt.
   */
  export interface PreloadingAttemptSource {
    key: Preload.PreloadingAttemptKey;
    ruleSetIds: Preload.RuleSetId[];
    nodeIds: DOM.BackendNodeId[];
  }
  /**
   * Preloading status values, see also PreloadingTriggeringOutcome. This
   * status is shared by prefetchStatusUpdated and prerenderStatusUpdated.
   */
  export type PreloadingStatus = "Pending" | "Running" | "Ready" | "Success" | "Failure" | "NotSupported";
  /**
   * Chrome manages different types of preloads together using a
   * concept of preloading pipeline. For example, if a site uses a
   * SpeculationRules for prerender, Chrome first starts a prefetch and
   * then upgrades it to prerender.
   * 
   * CDP events for them are emitted separately but they share
   * `PreloadPipelineId`.
   */
  export type PreloadPipelineId = string;
  /** List of FinalStatus reasons for Prerender2. */
  export type PrerenderFinalStatus = "Activated" | "Destroyed" | "LowEndDevice" | "InvalidSchemeRedirect" | "InvalidSchemeNavigation" | "NavigationRequestBlockedByCsp" | "MojoBinderPolicy" | "RendererProcessCrashed" | "RendererProcessKilled" | "Download" | "TriggerDestroyed" | "NavigationNotCommitted" | "NavigationBadHttpStatus" | "ClientCertRequested" | "NavigationRequestNetworkError" | "CancelAllHostsForTesting" | "DidFailLoad" | "Stop" | "SslCertificateError" | "LoginAuthRequested" | "UaChangeRequiresReload" | "BlockedByClient" | "AudioOutputDeviceRequested" | "MixedContent" | "TriggerBackgrounded" | "MemoryLimitExceeded" | "DataSaverEnabled" | "TriggerUrlHasEffectiveUrl" | "ActivatedBeforeStarted" | "InactivePageRestriction" | "StartFailed" | "TimeoutBackgrounded" | "CrossSiteRedirectInInitialNavigation" | "CrossSiteNavigationInInitialNavigation" | "SameSiteCrossOriginRedirectNotOptInInInitialNavigation" | "SameSiteCrossOriginNavigationNotOptInInInitialNavigation" | "ActivationNavigationParameterMismatch" | "ActivatedInBackground" | "EmbedderHostDisallowed" | "ActivationNavigationDestroyedBeforeSuccess" | "TabClosedByUserGesture" | "TabClosedWithoutUserGesture" | "PrimaryMainFrameRendererProcessCrashed" | "PrimaryMainFrameRendererProcessKilled" | "ActivationFramePolicyNotCompatible" | "PreloadingDisabled" | "BatterySaverEnabled" | "ActivatedDuringMainFrameNavigation" | "PreloadingUnsupportedByWebContents" | "CrossSiteRedirectInMainFrameNavigation" | "CrossSiteNavigationInMainFrameNavigation" | "SameSiteCrossOriginRedirectNotOptInInMainFrameNavigation" | "SameSiteCrossOriginNavigationNotOptInInMainFrameNavigation" | "MemoryPressureOnTrigger" | "MemoryPressureAfterTriggered" | "PrerenderingDisabledByDevTools" | "SpeculationRuleRemoved" | "ActivatedWithAuxiliaryBrowsingContexts" | "MaxNumOfRunningEagerPrerendersExceeded" | "MaxNumOfRunningNonEagerPrerendersExceeded" | "MaxNumOfRunningEmbedderPrerendersExceeded" | "PrerenderingUrlHasEffectiveUrl" | "RedirectedPrerenderingUrlHasEffectiveUrl" | "ActivationUrlHasEffectiveUrl" | "JavaScriptInterfaceAdded" | "JavaScriptInterfaceRemoved" | "AllPrerenderingCanceled" | "WindowClosed" | "SlowNetwork" | "OtherPrerenderedPageActivated" | "V8OptimizerDisabled" | "PrerenderFailedDuringPrefetch" | "BrowsingDataRemoved" | "PrerenderHostReused" | "FormSubmitWhenPrerendering";
  /** Information of headers to be displayed when the header mismatch occurred. */
  export interface PrerenderMismatchedHeaders {
    headerName: string;
    initialValue?: string;
    activationValue?: string;
  }
  /** Corresponds to SpeculationRuleSet */
  export interface RuleSet {
    id: Preload.RuleSetId;
    loaderId: Network.LoaderId;
    sourceText: string;
    backendNodeId?: DOM.BackendNodeId;
    url?: string;
    requestId?: Network.RequestId;
    errorType?: Preload.RuleSetErrorType;
    errorMessage?: string;
    tag?: string;
  }
  export type RuleSetErrorType = "SourceIsNotJsonObject" | "InvalidRulesSkipped" | "InvalidRulesetLevelTag";
  /** Unique id */
  export type RuleSetId = string;
  /**
   * The type of preloading attempted. It corresponds to
   * mojom::SpeculationAction (although PrefetchWithSubresources is omitted as it
   * isn't being used by clients).
   */
  export type SpeculationAction = "Prefetch" | "Prerender" | "PrerenderUntilScript";
  /**
   * Corresponds to mojom::SpeculationTargetHint.
   * See https://github.com/WICG/nav-speculation/blob/main/triggers.md#window-name-targeting-hints
   */
  export type SpeculationTargetHint = "Blank" | "Self";
  export interface DisableRequest {}
  export interface DisableResponse {}
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Fired when a prefetch attempt is updated. */
  export interface PrefetchStatusUpdatedEvent {
    key: Preload.PreloadingAttemptKey;
    pipelineId: Preload.PreloadPipelineId;
    initiatingFrameId: Page.FrameId;
    prefetchUrl: string;
    status: Preload.PreloadingStatus;
    prefetchStatus: Preload.PrefetchStatus;
    requestId: Network.RequestId;
  }
  /** Fired when a preload enabled state is updated. */
  export interface PreloadEnabledStateUpdatedEvent {
    disabledByPreference: boolean;
    disabledByDataSaver: boolean;
    disabledByBatterySaver: boolean;
    disabledByHoldbackPrefetchSpeculationRules: boolean;
    disabledByHoldbackPrerenderSpeculationRules: boolean;
  }
  /** Send a list of sources for all preloading attempts in a document. */
  export interface PreloadingAttemptSourcesUpdatedEvent {
    loaderId: Network.LoaderId;
    preloadingAttemptSources: Preload.PreloadingAttemptSource[];
  }
  /** Fired when a prerender attempt is updated. */
  export interface PrerenderStatusUpdatedEvent {
    key: Preload.PreloadingAttemptKey;
    pipelineId: Preload.PreloadPipelineId;
    status: Preload.PreloadingStatus;
    prerenderStatus?: Preload.PrerenderFinalStatus;
    disallowedMojoInterface?: string;
    mismatchedHeaders?: Preload.PrerenderMismatchedHeaders[];
  }
  export interface RuleSetRemovedEvent {
    id: Preload.RuleSetId;
  }
  /** Upsert. Currently, it is only emitted when a rule set added. */
  export interface RuleSetUpdatedEvent {
    ruleSet: Preload.RuleSet;
  }
}

export namespace Profiler {
  /** Coverage data for a source range. */
  export interface CoverageRange {
    startOffset: number;
    endOffset: number;
    count: number;
  }
  /** Coverage data for a JavaScript function. */
  export interface FunctionCoverage {
    functionName: string;
    ranges: Profiler.CoverageRange[];
    isBlockCoverage: boolean;
  }
  /** Specifies a number of samples attributed to a certain source position. */
  export interface PositionTickInfo {
    line: number;
    ticks: number;
  }
  /** Profile. */
  export interface Profile {
    nodes: Profiler.ProfileNode[];
    startTime: number;
    endTime: number;
    samples?: number[];
    timeDeltas?: number[];
  }
  /** Profile node. Holds callsite information, execution statistics and child nodes. */
  export interface ProfileNode {
    id: number;
    callFrame: Runtime.CallFrame;
    hitCount?: number;
    children?: number[];
    deoptReason?: string;
    positionTicks?: Profiler.PositionTickInfo[];
  }
  /** Coverage data for a JavaScript script. */
  export interface ScriptCoverage {
    scriptId: Runtime.ScriptId;
    url: string;
    functions: Profiler.FunctionCoverage[];
  }
  export interface DisableRequest {}
  export interface DisableResponse {}
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Collect coverage data for the current isolate. The coverage data may be incomplete due to
   * garbage collection.
   */
  export interface GetBestEffortCoverageRequest {}
  export interface GetBestEffortCoverageResponse {
    result: Profiler.ScriptCoverage[];
  }
  /** Changes CPU profiler sampling interval. Must be called before CPU profiles recording started. */
  export interface SetSamplingIntervalRequest {
    interval: number;
  }
  export interface SetSamplingIntervalResponse {}
  export interface StartRequest {}
  export interface StartResponse {}
  /**
   * Enable precise code coverage. Coverage data for JavaScript executed before enabling precise code
   * coverage may be incomplete. Enabling prevents running optimized code and resets execution
   * counters.
   */
  export interface StartPreciseCoverageRequest {
    callCount?: boolean;
    detailed?: boolean;
    allowTriggeredUpdates?: boolean;
  }
  export interface StartPreciseCoverageResponse {
    timestamp: number;
  }
  export interface StopRequest {}
  export interface StopResponse {
    profile: Profiler.Profile;
  }
  /**
   * Disable precise code coverage. Disabling releases unnecessary execution count records and allows
   * executing optimized code.
   */
  export interface StopPreciseCoverageRequest {}
  export interface StopPreciseCoverageResponse {}
  /**
   * Collect coverage data for the current isolate, and resets execution counters. Precise code
   * coverage needs to have started.
   */
  export interface TakePreciseCoverageRequest {}
  export interface TakePreciseCoverageResponse {
    result: Profiler.ScriptCoverage[];
    timestamp: number;
  }
  export interface ConsoleProfileFinishedEvent {
    id: string;
    location: Debugger.Location;
    profile: Profiler.Profile;
    title?: string;
  }
  /** Sent when new profile recording is started using console.profile() call. */
  export interface ConsoleProfileStartedEvent {
    id: string;
    location: Debugger.Location;
    title?: string;
  }
  /**
   * Reports coverage delta since the last poll (either from an event like this, or from
   * `takePreciseCoverage` for the current isolate. May only be sent if precise code
   * coverage has been started. This event can be trigged by the embedder to, for example,
   * trigger collection of coverage data immediately at a certain point in time.
   * @experimental
   */
  export interface PreciseCoverageDeltaUpdateEvent {
    timestamp: number;
    occasion: string;
    result: Profiler.ScriptCoverage[];
  }
}

/**
 * This domain allows interacting with the browser to control PWAs.
 * @experimental
 */
export namespace PWA {
  /** If user prefers opening the app in browser or an app window. */
  export type DisplayMode = "standalone" | "browser";
  export interface FileHandler {
    action: string;
    accepts: PWA.FileHandlerAccept[];
    displayName: string;
  }
  /**
   * The following types are the replica of
   * https://crsrc.org/c/chrome/browser/web_applications/proto/web_app_os_integration_state.proto;drc=9910d3be894c8f142c977ba1023f30a656bc13fc;l=67
   */
  export interface FileHandlerAccept {
    mediaType: string;
    fileExtensions: string[];
  }
  /**
   * Changes user settings of the web app identified by its manifestId. If the
   * app was not installed, this command returns an error. Unset parameters will
   * be ignored; unrecognized values will cause an error.
   * 
   * Unlike the ones defined in the manifest files of the web apps, these
   * settings are provided by the browser and controlled by the users, they
   * impact the way the browser handling the web apps.
   * 
   * See the comment of each parameter.
   */
  export interface ChangeAppUserSettingsRequest {
    manifestId: string;
    linkCapturing?: boolean;
    displayMode?: PWA.DisplayMode;
  }
  export interface ChangeAppUserSettingsResponse {}
  /** Returns the following OS state for the given manifest id. */
  export interface GetOsAppStateRequest {
    manifestId: string;
  }
  export interface GetOsAppStateResponse {
    badgeCount: number;
    fileHandlers: PWA.FileHandler[];
  }
  /**
   * Installs the given manifest identity, optionally using the given installUrlOrBundleUrl
   * 
   * IWA-specific install description:
   * manifestId corresponds to isolated-app:// + web_package::SignedWebBundleId
   * 
   * File installation mode:
   * The installUrlOrBundleUrl can be either file:// or http(s):// pointing
   * to a signed web bundle (.swbn). In this case SignedWebBundleId must correspond to
   * The .swbn file's signing key.
   * 
   * Dev proxy installation mode:
   * installUrlOrBundleUrl must be http(s):// that serves dev mode IWA.
   * web_package::SignedWebBundleId must be of type dev proxy.
   * 
   * The advantage of dev proxy mode is that all changes to IWA
   * automatically will be reflected in the running app without
   * reinstallation.
   * 
   * To generate bundle id for proxy mode:
   * 1. Generate 32 random bytes.
   * 2. Add a specific suffix at the end following the documentation
   *    https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md#suffix
   * 3. Encode the entire sequence using Base32 without padding.
   * 
   * If Chrome is not in IWA dev
   * mode, the installation will fail, regardless of the state of the allowlist.
   */
  export interface InstallRequest {
    manifestId: string;
    installUrlOrBundleUrl?: string;
  }
  export interface InstallResponse {}
  /**
   * Launches the installed web app, or an url in the same web app instead of the
   * default start url if it is provided. Returns a page Target.TargetID which
   * can be used to attach to via Target.attachToTarget or similar APIs.
   */
  export interface LaunchRequest {
    manifestId: string;
    url?: string;
  }
  export interface LaunchResponse {
    targetId: Target.TargetID;
  }
  /**
   * Opens one or more local files from an installed web app identified by its
   * manifestId. The web app needs to have file handlers registered to process
   * the files. The API returns one or more page Target.TargetIDs which can be
   * used to attach to via Target.attachToTarget or similar APIs.
   * If some files in the parameters cannot be handled by the web app, they will
   * be ignored. If none of the files can be handled, this API returns an error.
   * If no files are provided as the parameter, this API also returns an error.
   * 
   * According to the definition of the file handlers in the manifest file, one
   * Target.TargetID may represent a page handling one or more files. The order
   * of the returned Target.TargetIDs is not guaranteed.
   * 
   * TODO(crbug.com/339454034): Check the existences of the input files.
   */
  export interface LaunchFilesInAppRequest {
    manifestId: string;
    files: string[];
  }
  export interface LaunchFilesInAppResponse {
    targetIds: Target.TargetID[];
  }
  /**
   * Opens the current page in its web app identified by the manifest id, needs
   * to be called on a page target. This function returns immediately without
   * waiting for the app to finish loading.
   */
  export interface OpenCurrentPageInAppRequest {
    manifestId: string;
  }
  export interface OpenCurrentPageInAppResponse {}
  /** Uninstalls the given manifest_id and closes any opened app windows. */
  export interface UninstallRequest {
    manifestId: string;
  }
  export interface UninstallResponse {}
}

/**
 * Runtime domain exposes JavaScript runtime by means of remote evaluation and mirror objects.
Evaluation results are returned as mirror object that expose object type, string representation
and unique identifier that can be used for further object reference. Original objects are
maintained in memory unless they are either explicitly released or are released along with the
other objects in their object group.
 */
export namespace Runtime {
  /**
   * Represents function call argument. Either remote object id `objectId`, primitive `value`,
   * unserializable primitive value or neither of (for undefined) them should be specified.
   */
  export interface CallArgument {
    value?: unknown;
    unserializableValue?: Runtime.UnserializableValue;
    objectId?: Runtime.RemoteObjectId;
  }
  /** Stack entry for runtime errors and assertions. */
  export interface CallFrame {
    functionName: string;
    scriptId: Runtime.ScriptId;
    url: string;
    lineNumber: number;
    columnNumber: number;
  }
  /** @experimental */
  export interface CustomPreview {
    header: string;
    bodyGetterId?: Runtime.RemoteObjectId;
  }
  /** Represents deep serialized value. */
  export interface DeepSerializedValue {
    type: "undefined" | "null" | "string" | "number" | "boolean" | "bigint" | "regexp" | "date" | "symbol" | "array" | "object" | "function" | "map" | "set" | "weakmap" | "weakset" | "error" | "proxy" | "promise" | "typedarray" | "arraybuffer" | "node" | "window" | "generator";
    value?: unknown;
    objectId?: string;
    weakLocalObjectReference?: number;
  }
  /** @experimental */
  export interface EntryPreview {
    key?: Runtime.ObjectPreview;
    value: Runtime.ObjectPreview;
  }
  /**
   * Detailed information about exception (or error) that was thrown during script compilation or
   * execution.
   */
  export interface ExceptionDetails {
    exceptionId: number;
    text: string;
    lineNumber: number;
    columnNumber: number;
    scriptId?: Runtime.ScriptId;
    url?: string;
    stackTrace?: Runtime.StackTrace;
    exception?: Runtime.RemoteObject;
    executionContextId?: Runtime.ExecutionContextId;
    exceptionMetaData?: Record<string, unknown>;
  }
  /** Description of an isolated world. */
  export interface ExecutionContextDescription {
    id: Runtime.ExecutionContextId;
    origin: string;
    name: string;
    uniqueId: string;
    auxData?: Record<string, unknown>;
  }
  /** Id of an execution context. */
  export type ExecutionContextId = number;
  /** Object internal property descriptor. This property isn't normally visible in JavaScript code. */
  export interface InternalPropertyDescriptor {
    name: string;
    value?: Runtime.RemoteObject;
  }
  /**
   * Object containing abbreviated remote object value.
   * @experimental
   */
  export interface ObjectPreview {
    type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
    subtype?: "array" | "null" | "node" | "regexp" | "date" | "map" | "set" | "weakmap" | "weakset" | "iterator" | "generator" | "error" | "proxy" | "promise" | "typedarray" | "arraybuffer" | "dataview" | "webassemblymemory" | "wasmvalue" | "trustedtype";
    description?: string;
    overflow: boolean;
    properties: Runtime.PropertyPreview[];
    entries?: Runtime.EntryPreview[];
  }
  /**
   * Object private field descriptor.
   * @experimental
   */
  export interface PrivatePropertyDescriptor {
    name: string;
    value?: Runtime.RemoteObject;
    get?: Runtime.RemoteObject;
    set?: Runtime.RemoteObject;
  }
  /** Object property descriptor. */
  export interface PropertyDescriptor {
    name: string;
    value?: Runtime.RemoteObject;
    writable?: boolean;
    get?: Runtime.RemoteObject;
    set?: Runtime.RemoteObject;
    configurable: boolean;
    enumerable: boolean;
    wasThrown?: boolean;
    isOwn?: boolean;
    symbol?: Runtime.RemoteObject;
  }
  /** @experimental */
  export interface PropertyPreview {
    name: string;
    type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "accessor" | "bigint";
    value?: string;
    valuePreview?: Runtime.ObjectPreview;
    subtype?: "array" | "null" | "node" | "regexp" | "date" | "map" | "set" | "weakmap" | "weakset" | "iterator" | "generator" | "error" | "proxy" | "promise" | "typedarray" | "arraybuffer" | "dataview" | "webassemblymemory" | "wasmvalue" | "trustedtype";
  }
  /** Mirror object referencing original JavaScript object. */
  export interface RemoteObject {
    type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
    subtype?: "array" | "null" | "node" | "regexp" | "date" | "map" | "set" | "weakmap" | "weakset" | "iterator" | "generator" | "error" | "proxy" | "promise" | "typedarray" | "arraybuffer" | "dataview" | "webassemblymemory" | "wasmvalue" | "trustedtype";
    className?: string;
    value?: unknown;
    unserializableValue?: Runtime.UnserializableValue;
    description?: string;
    deepSerializedValue?: Runtime.DeepSerializedValue;
    objectId?: Runtime.RemoteObjectId;
    preview?: Runtime.ObjectPreview;
    customPreview?: Runtime.CustomPreview;
  }
  /** Unique object identifier. */
  export type RemoteObjectId = string;
  /** Unique script identifier. */
  export type ScriptId = string;
  /** Represents options for serialization. Overrides `generatePreview` and `returnByValue`. */
  export interface SerializationOptions {
    serialization: "deep" | "json" | "idOnly";
    maxDepth?: number;
    additionalParameters?: Record<string, unknown>;
  }
  /** Call frames for assertions or error messages. */
  export interface StackTrace {
    description?: string;
    callFrames: Runtime.CallFrame[];
    parent?: Runtime.StackTrace;
    parentId?: Runtime.StackTraceId;
  }
  /**
   * If `debuggerId` is set stack trace comes from another debugger and can be resolved there. This
   * allows to track cross-debugger calls. See `Runtime.StackTrace` and `Debugger.paused` for usages.
   * @experimental
   */
  export interface StackTraceId {
    id: string;
    debuggerId?: Runtime.UniqueDebuggerId;
  }
  /** Number of milliseconds. */
  export type TimeDelta = number;
  /** Number of milliseconds since epoch. */
  export type Timestamp = number;
  /**
   * Unique identifier of current debugger.
   * @experimental
   */
  export type UniqueDebuggerId = string;
  /**
   * Primitive value which cannot be JSON-stringified. Includes values `-0`, `NaN`, `Infinity`,
   * `-Infinity`, and bigint literals.
   */
  export type UnserializableValue = string;
  /**
   * If executionContextId is empty, adds binding with the given name on the
   * global objects of all inspected contexts, including those created later,
   * bindings survive reloads.
   * Binding function takes exactly one argument, this argument should be string,
   * in case of any other input, function throws an exception.
   * Each binding function call produces Runtime.bindingCalled notification.
   */
  export interface AddBindingRequest {
    name: string;
    executionContextId?: Runtime.ExecutionContextId;
    executionContextName?: string;
  }
  export interface AddBindingResponse {}
  /** Add handler to promise with given promise object id. */
  export interface AwaitPromiseRequest {
    promiseObjectId: Runtime.RemoteObjectId;
    returnByValue?: boolean;
    generatePreview?: boolean;
  }
  export interface AwaitPromiseResponse {
    result: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /**
   * Calls function with given declaration on the given object. Object group of the result is
   * inherited from the target object.
   */
  export interface CallFunctionOnRequest {
    functionDeclaration: string;
    objectId?: Runtime.RemoteObjectId;
    arguments?: Runtime.CallArgument[];
    silent?: boolean;
    returnByValue?: boolean;
    generatePreview?: boolean;
    userGesture?: boolean;
    awaitPromise?: boolean;
    executionContextId?: Runtime.ExecutionContextId;
    objectGroup?: string;
    throwOnSideEffect?: boolean;
    uniqueContextId?: string;
    serializationOptions?: Runtime.SerializationOptions;
  }
  export interface CallFunctionOnResponse {
    result: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /** Compiles expression. */
  export interface CompileScriptRequest {
    expression: string;
    sourceURL: string;
    persistScript: boolean;
    executionContextId?: Runtime.ExecutionContextId;
  }
  export interface CompileScriptResponse {
    scriptId?: Runtime.ScriptId;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /** Disables reporting of execution contexts creation. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Discards collected exceptions and console API calls. */
  export interface DiscardConsoleEntriesRequest {}
  export interface DiscardConsoleEntriesResponse {}
  /**
   * Enables reporting of execution contexts creation by means of `executionContextCreated` event.
   * When the reporting gets enabled the event will be sent immediately for each existing execution
   * context.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Evaluates expression on global object. */
  export interface EvaluateRequest {
    expression: string;
    objectGroup?: string;
    includeCommandLineAPI?: boolean;
    silent?: boolean;
    contextId?: Runtime.ExecutionContextId;
    returnByValue?: boolean;
    generatePreview?: boolean;
    userGesture?: boolean;
    awaitPromise?: boolean;
    throwOnSideEffect?: boolean;
    timeout?: Runtime.TimeDelta;
    disableBreaks?: boolean;
    replMode?: boolean;
    allowUnsafeEvalBlockedByCSP?: boolean;
    uniqueContextId?: string;
    serializationOptions?: Runtime.SerializationOptions;
  }
  export interface EvaluateResponse {
    result: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /**
   * This method tries to lookup and populate exception details for a
   * JavaScript Error object.
   * Note that the stackTrace portion of the resulting exceptionDetails will
   * only be populated if the Runtime domain was enabled at the time when the
   * Error was thrown.
   * @experimental
   */
  export interface GetExceptionDetailsRequest {
    errorObjectId: Runtime.RemoteObjectId;
  }
  export interface GetExceptionDetailsResponse {
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /**
   * Returns the JavaScript heap usage.
   * It is the total usage of the corresponding isolate not scoped to a particular Runtime.
   * @experimental
   */
  export interface GetHeapUsageRequest {}
  export interface GetHeapUsageResponse {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize: number;
    backingStorageSize: number;
  }
  /**
   * Returns the isolate id.
   * @experimental
   */
  export interface GetIsolateIdRequest {}
  export interface GetIsolateIdResponse {
    id: string;
  }
  /**
   * Returns properties of a given object. Object group of the result is inherited from the target
   * object.
   */
  export interface GetPropertiesRequest {
    objectId: Runtime.RemoteObjectId;
    ownProperties?: boolean;
    accessorPropertiesOnly?: boolean;
    generatePreview?: boolean;
    nonIndexedPropertiesOnly?: boolean;
  }
  export interface GetPropertiesResponse {
    result: Runtime.PropertyDescriptor[];
    internalProperties?: Runtime.InternalPropertyDescriptor[];
    privateProperties?: Runtime.PrivatePropertyDescriptor[];
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /** Returns all let, const and class variables from global scope. */
  export interface GlobalLexicalScopeNamesRequest {
    executionContextId?: Runtime.ExecutionContextId;
  }
  export interface GlobalLexicalScopeNamesResponse {
    names: string[];
  }
  export interface QueryObjectsRequest {
    prototypeObjectId: Runtime.RemoteObjectId;
    objectGroup?: string;
  }
  export interface QueryObjectsResponse {
    objects: Runtime.RemoteObject;
  }
  /** Releases remote object with given id. */
  export interface ReleaseObjectRequest {
    objectId: Runtime.RemoteObjectId;
  }
  export interface ReleaseObjectResponse {}
  /** Releases all remote objects that belong to a given group. */
  export interface ReleaseObjectGroupRequest {
    objectGroup: string;
  }
  export interface ReleaseObjectGroupResponse {}
  /**
   * This method does not remove binding function from global object but
   * unsubscribes current runtime agent from Runtime.bindingCalled notifications.
   */
  export interface RemoveBindingRequest {
    name: string;
  }
  export interface RemoveBindingResponse {}
  /** Tells inspected instance to run if it was waiting for debugger to attach. */
  export interface RunIfWaitingForDebuggerRequest {}
  export interface RunIfWaitingForDebuggerResponse {}
  /** Runs script with given id in a given context. */
  export interface RunScriptRequest {
    scriptId: Runtime.ScriptId;
    executionContextId?: Runtime.ExecutionContextId;
    objectGroup?: string;
    silent?: boolean;
    includeCommandLineAPI?: boolean;
    returnByValue?: boolean;
    generatePreview?: boolean;
    awaitPromise?: boolean;
  }
  export interface RunScriptResponse {
    result: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }
  /** @experimental */
  export interface SetCustomObjectFormatterEnabledRequest {
    enabled: boolean;
  }
  export interface SetCustomObjectFormatterEnabledResponse {}
  /** @experimental */
  export interface SetMaxCallStackSizeToCaptureRequest {
    size: number;
  }
  export interface SetMaxCallStackSizeToCaptureResponse {}
  /**
   * Terminate current or next JavaScript execution.
   * Will cancel the termination when the outer-most script execution ends.
   * @experimental
   */
  export interface TerminateExecutionRequest {}
  export interface TerminateExecutionResponse {}
  /**
   * Notification is issued every time when binding is called.
   * @experimental
   */
  export interface BindingCalledEvent {
    name: string;
    payload: string;
    executionContextId: Runtime.ExecutionContextId;
  }
  /** Issued when console API was called. */
  export interface ConsoleAPICalledEvent {
    type: "log" | "debug" | "info" | "error" | "warning" | "dir" | "dirxml" | "table" | "trace" | "clear" | "startGroup" | "startGroupCollapsed" | "endGroup" | "assert" | "profile" | "profileEnd" | "count" | "timeEnd";
    args: Runtime.RemoteObject[];
    executionContextId: Runtime.ExecutionContextId;
    timestamp: Runtime.Timestamp;
    stackTrace?: Runtime.StackTrace;
    context?: string;
  }
  /** Issued when unhandled exception was revoked. */
  export interface ExceptionRevokedEvent {
    reason: string;
    exceptionId: number;
  }
  /** Issued when exception was thrown and unhandled. */
  export interface ExceptionThrownEvent {
    timestamp: Runtime.Timestamp;
    exceptionDetails: Runtime.ExceptionDetails;
  }
  /** Issued when new execution context is created. */
  export interface ExecutionContextCreatedEvent {
    context: Runtime.ExecutionContextDescription;
  }
  /** Issued when execution context is destroyed. */
  export interface ExecutionContextDestroyedEvent {
    executionContextId: Runtime.ExecutionContextId;
    executionContextUniqueId: string;
  }
  /** Issued when all executionContexts were cleared in browser */
  export interface ExecutionContextsClearedEvent {}
  /**
   * Issued when object should be inspected (for example, as a result of inspect() command line API
   * call).
   */
  export interface InspectRequestedEvent {
    object: Runtime.RemoteObject;
    hints: Record<string, unknown>;
    executionContextId?: Runtime.ExecutionContextId;
  }
}

/**
 * This domain is deprecated.
 * @deprecated
 */
export namespace Schema {
  /** Description of the protocol domain. */
  export interface Domain {
    name: string;
    version: string;
  }
  /** Returns supported domains. */
  export interface GetDomainsRequest {}
  export interface GetDomainsResponse {
    domains: Schema.Domain[];
  }
}

export namespace Security {
  /**
   * The action to take when a certificate error occurs. continue will continue processing the
   * request and cancel will cancel the request.
   */
  export type CertificateErrorAction = "continue" | "cancel";
  /** An internal certificate ID value. */
  export type CertificateId = number;
  /**
   * Details about the security state of the page certificate.
   * @experimental
   */
  export interface CertificateSecurityState {
    protocol: string;
    keyExchange: string;
    keyExchangeGroup?: string;
    cipher: string;
    mac?: string;
    certificate: string[];
    subjectName: string;
    issuer: string;
    validFrom: Network.TimeSinceEpoch;
    validTo: Network.TimeSinceEpoch;
    certificateNetworkError?: string;
    certificateHasWeakSignature: boolean;
    certificateHasSha1Signature: boolean;
    modernSSL: boolean;
    obsoleteSslProtocol: boolean;
    obsoleteSslKeyExchange: boolean;
    obsoleteSslCipher: boolean;
    obsoleteSslSignature: boolean;
  }
  /**
   * Information about insecure content on the page.
   * @deprecated
   */
  export interface InsecureContentStatus {
    ranMixedContent: boolean;
    displayedMixedContent: boolean;
    containedMixedForm: boolean;
    ranContentWithCertErrors: boolean;
    displayedContentWithCertErrors: boolean;
    ranInsecureContentStyle: Security.SecurityState;
    displayedInsecureContentStyle: Security.SecurityState;
  }
  /**
   * A description of mixed content (HTTP resources on HTTPS pages), as defined by
   * https://www.w3.org/TR/mixed-content/#categories
   */
  export type MixedContentType = "blockable" | "optionally-blockable" | "none";
  /** @experimental */
  export interface SafetyTipInfo {
    safetyTipStatus: Security.SafetyTipStatus;
    safeUrl?: string;
  }
  /** @experimental */
  export type SafetyTipStatus = "badReputation" | "lookalike";
  /** The security level of a page or resource. */
  export type SecurityState = "unknown" | "neutral" | "insecure" | "secure" | "info" | "insecure-broken";
  /** An explanation of an factor contributing to the security state. */
  export interface SecurityStateExplanation {
    securityState: Security.SecurityState;
    title: string;
    summary: string;
    description: string;
    mixedContentType: Security.MixedContentType;
    certificate: string[];
    recommendations?: string[];
  }
  /**
   * Security state information about the page.
   * @experimental
   */
  export interface VisibleSecurityState {
    securityState: Security.SecurityState;
    certificateSecurityState?: Security.CertificateSecurityState;
    safetyTipInfo?: Security.SafetyTipInfo;
    securityStateIssueIds: string[];
  }
  /** Disables tracking security state changes. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables tracking security state changes. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Handles a certificate error that fired a certificateError event.
   * @deprecated
   */
  export interface HandleCertificateErrorRequest {
    eventId: number;
    action: Security.CertificateErrorAction;
  }
  export interface HandleCertificateErrorResponse {}
  /** Enable/disable whether all certificate errors should be ignored. */
  export interface SetIgnoreCertificateErrorsRequest {
    ignore: boolean;
  }
  export interface SetIgnoreCertificateErrorsResponse {}
  /**
   * Enable/disable overriding certificate errors. If enabled, all certificate error events need to
   * be handled by the DevTools client and should be answered with `handleCertificateError` commands.
   * @deprecated
   */
  export interface SetOverrideCertificateErrorsRequest {
    override: boolean;
  }
  export interface SetOverrideCertificateErrorsResponse {}
  /**
   * There is a certificate error. If overriding certificate errors is enabled, then it should be
   * handled with the `handleCertificateError` command. Note: this event does not fire if the
   * certificate error has been allowed internally. Only one client per target should override
   * certificate errors at the same time.
   * @deprecated
   */
  export interface CertificateErrorEvent {
    eventId: number;
    errorType: string;
    requestURL: string;
  }
  /**
   * The security state of the page changed. No longer being sent.
   * @deprecated
   */
  export interface SecurityStateChangedEvent {
    securityState: Security.SecurityState;
    schemeIsCryptographic: boolean;
    explanations: Security.SecurityStateExplanation[];
    insecureContentStatus: Security.InsecureContentStatus;
    summary?: string;
  }
  /**
   * The security state of the page changed.
   * @experimental
   */
  export interface VisibleSecurityStateChangedEvent {
    visibleSecurityState: Security.VisibleSecurityState;
  }
}

/**
 * ServiceWorker
 * @experimental
 */
export namespace ServiceWorker {
  export type RegistrationID = string;
  /** ServiceWorker error message. */
  export interface ServiceWorkerErrorMessage {
    errorMessage: string;
    registrationId: ServiceWorker.RegistrationID;
    versionId: string;
    sourceURL: string;
    lineNumber: number;
    columnNumber: number;
  }
  /** ServiceWorker registration. */
  export interface ServiceWorkerRegistration {
    registrationId: ServiceWorker.RegistrationID;
    scopeURL: string;
    isDeleted: boolean;
  }
  /** ServiceWorker version. */
  export interface ServiceWorkerVersion {
    versionId: string;
    registrationId: ServiceWorker.RegistrationID;
    scriptURL: string;
    runningStatus: ServiceWorker.ServiceWorkerVersionRunningStatus;
    status: ServiceWorker.ServiceWorkerVersionStatus;
    scriptLastModified?: number;
    scriptResponseTime?: number;
    controlledClients?: Target.TargetID[];
    targetId?: Target.TargetID;
    routerRules?: string;
  }
  export type ServiceWorkerVersionRunningStatus = "stopped" | "starting" | "running" | "stopping";
  export type ServiceWorkerVersionStatus = "new" | "installing" | "installed" | "activating" | "activated" | "redundant";
  export interface DeliverPushMessageRequest {
    origin: string;
    registrationId: ServiceWorker.RegistrationID;
    data: string;
  }
  export interface DeliverPushMessageResponse {}
  export interface DisableRequest {}
  export interface DisableResponse {}
  export interface DispatchPeriodicSyncEventRequest {
    origin: string;
    registrationId: ServiceWorker.RegistrationID;
    tag: string;
  }
  export interface DispatchPeriodicSyncEventResponse {}
  export interface DispatchSyncEventRequest {
    origin: string;
    registrationId: ServiceWorker.RegistrationID;
    tag: string;
    lastChance: boolean;
  }
  export interface DispatchSyncEventResponse {}
  export interface EnableRequest {}
  export interface EnableResponse {}
  export interface SetForceUpdateOnPageLoadRequest {
    forceUpdateOnPageLoad: boolean;
  }
  export interface SetForceUpdateOnPageLoadResponse {}
  export interface SkipWaitingRequest {
    scopeURL: string;
  }
  export interface SkipWaitingResponse {}
  export interface StartWorkerRequest {
    scopeURL: string;
  }
  export interface StartWorkerResponse {}
  export interface StopAllWorkersRequest {}
  export interface StopAllWorkersResponse {}
  export interface StopWorkerRequest {
    versionId: string;
  }
  export interface StopWorkerResponse {}
  export interface UnregisterRequest {
    scopeURL: string;
  }
  export interface UnregisterResponse {}
  export interface UpdateRegistrationRequest {
    scopeURL: string;
  }
  export interface UpdateRegistrationResponse {}
  export interface WorkerErrorReportedEvent {
    errorMessage: ServiceWorker.ServiceWorkerErrorMessage;
  }
  export interface WorkerRegistrationUpdatedEvent {
    registrations: ServiceWorker.ServiceWorkerRegistration[];
  }
  export interface WorkerVersionUpdatedEvent {
    versions: ServiceWorker.ServiceWorkerVersion[];
  }
}

/**
 * SmartCardEmulation
 * @experimental
 */
export namespace SmartCardEmulation {
  /** Maps to |SCARD_*| connection state values. */
  export type ConnectionState = "absent" | "present" | "swallowed" | "powered" | "negotiable" | "specific";
  /** Indicates what the reader should do with the card. */
  export type Disposition = "leave-card" | "reset-card" | "unpower-card" | "eject-card";
  /** Maps to the |SCARD_PROTOCOL_*| values. */
  export type Protocol = "t0" | "t1" | "raw";
  /** Maps to the |SCARD_PROTOCOL_*| flags. */
  export interface ProtocolSet {
    t0?: boolean;
    t1?: boolean;
    raw?: boolean;
  }
  /** Maps to the |SCARD_STATE_*| flags. */
  export interface ReaderStateFlags {
    unaware?: boolean;
    ignore?: boolean;
    changed?: boolean;
    unknown?: boolean;
    unavailable?: boolean;
    empty?: boolean;
    present?: boolean;
    exclusive?: boolean;
    inuse?: boolean;
    mute?: boolean;
    unpowered?: boolean;
  }
  export interface ReaderStateIn {
    reader: string;
    currentState: SmartCardEmulation.ReaderStateFlags;
    currentInsertionCount: number;
  }
  export interface ReaderStateOut {
    reader: string;
    eventState: SmartCardEmulation.ReaderStateFlags;
    eventCount: number;
    atr: string;
  }
  /**
   * Indicates the PC/SC error code.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__ErrorCodes.html
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/secauthn/authentication-return-values
   */
  export type ResultCode = "success" | "removed-card" | "reset-card" | "unpowered-card" | "unresponsive-card" | "unsupported-card" | "reader-unavailable" | "sharing-violation" | "not-transacted" | "no-smartcard" | "proto-mismatch" | "system-cancelled" | "not-ready" | "cancelled" | "insufficient-buffer" | "invalid-handle" | "invalid-parameter" | "invalid-value" | "no-memory" | "timeout" | "unknown-reader" | "unsupported-feature" | "no-readers-available" | "service-stopped" | "no-service" | "comm-error" | "internal-error" | "server-too-busy" | "unexpected" | "shutdown" | "unknown-card" | "unknown";
  /** Maps to the |SCARD_SHARE_*| values. */
  export type ShareMode = "shared" | "exclusive" | "direct";
  /** Disables the |SmartCardEmulation| domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables the |SmartCardEmulation| domain. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /**
   * Reports the result of a |SCardBeginTransaction| call.
   * On success, this creates a new transaction object.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
   */
  export interface ReportBeginTransactionResultRequest {
    requestId: string;
    handle: number;
  }
  export interface ReportBeginTransactionResultResponse {}
  /**
   * Reports the successful result of a |SCardConnect| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
   */
  export interface ReportConnectResultRequest {
    requestId: string;
    handle: number;
    activeProtocol?: SmartCardEmulation.Protocol;
  }
  export interface ReportConnectResultResponse {}
  /**
   * Reports the successful result of a call that sends back data on success.
   * Used for |SCardTransmit|, |SCardControl|, and |SCardGetAttrib|.
   * 
   * This maps to:
   * 1. SCardTransmit
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
   * 
   * 2. SCardControl
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
   * 
   * 3. SCardGetAttrib
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
   */
  export interface ReportDataResultRequest {
    requestId: string;
    data: string;
  }
  export interface ReportDataResultResponse {}
  /** Reports an error result for the given request. */
  export interface ReportErrorRequest {
    requestId: string;
    resultCode: SmartCardEmulation.ResultCode;
  }
  export interface ReportErrorResponse {}
  /**
   * Reports the successful result of a |SCardEstablishContext| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
   */
  export interface ReportEstablishContextResultRequest {
    requestId: string;
    contextId: number;
  }
  export interface ReportEstablishContextResultResponse {}
  /**
   * Reports the successful result of a |SCardGetStatusChange| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
   */
  export interface ReportGetStatusChangeResultRequest {
    requestId: string;
    readerStates: SmartCardEmulation.ReaderStateOut[];
  }
  export interface ReportGetStatusChangeResultResponse {}
  /**
   * Reports the successful result of a |SCardListReaders| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
   */
  export interface ReportListReadersResultRequest {
    requestId: string;
    readers: string[];
  }
  export interface ReportListReadersResultResponse {}
  /**
   * Reports the successful result of a call that returns only a result code.
   * Used for: |SCardCancel|, |SCardDisconnect|, |SCardSetAttrib|, |SCardEndTransaction|.
   * 
   * This maps to:
   * 1. SCardCancel
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
   * 
   * 2. SCardDisconnect
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
   * 
   * 3. SCardSetAttrib
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
   * 
   * 4. SCardEndTransaction
   *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
   *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
   */
  export interface ReportPlainResultRequest {
    requestId: string;
  }
  export interface ReportPlainResultResponse {}
  /**
   * Reports the successful result of a |SCardReleaseContext| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
   */
  export interface ReportReleaseContextResultRequest {
    requestId: string;
  }
  export interface ReportReleaseContextResultResponse {}
  /**
   * Reports the successful result of a |SCardStatus| call.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
   */
  export interface ReportStatusResultRequest {
    requestId: string;
    readerName: string;
    state: SmartCardEmulation.ConnectionState;
    atr: string;
    protocol?: SmartCardEmulation.Protocol;
  }
  export interface ReportStatusResultResponse {}
  /**
   * Fired when |SCardBeginTransaction| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
   */
  export interface BeginTransactionRequestedEvent {
    requestId: string;
    handle: number;
  }
  /**
   * Fired when |SCardCancel| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
   */
  export interface CancelRequestedEvent {
    requestId: string;
    contextId: number;
  }
  /**
   * Fired when |SCardConnect| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
   */
  export interface ConnectRequestedEvent {
    requestId: string;
    contextId: number;
    reader: string;
    shareMode: SmartCardEmulation.ShareMode;
    preferredProtocols: SmartCardEmulation.ProtocolSet;
  }
  /**
   * Fired when |SCardControl| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
   */
  export interface ControlRequestedEvent {
    requestId: string;
    handle: number;
    controlCode: number;
    data: string;
  }
  /**
   * Fired when |SCardDisconnect| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
   */
  export interface DisconnectRequestedEvent {
    requestId: string;
    handle: number;
    disposition: SmartCardEmulation.Disposition;
  }
  /**
   * Fired when |SCardEndTransaction| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
   */
  export interface EndTransactionRequestedEvent {
    requestId: string;
    handle: number;
    disposition: SmartCardEmulation.Disposition;
  }
  /**
   * Fired when |SCardEstablishContext| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
   */
  export interface EstablishContextRequestedEvent {
    requestId: string;
  }
  /**
   * Fired when |SCardGetAttrib| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
   */
  export interface GetAttribRequestedEvent {
    requestId: string;
    handle: number;
    attribId: number;
  }
  /**
   * Fired when |SCardGetStatusChange| is called. Timeout is specified in milliseconds.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
   */
  export interface GetStatusChangeRequestedEvent {
    requestId: string;
    contextId: number;
    readerStates: SmartCardEmulation.ReaderStateIn[];
    timeout?: number;
  }
  /**
   * Fired when |SCardListReaders| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
   */
  export interface ListReadersRequestedEvent {
    requestId: string;
    contextId: number;
  }
  /**
   * Fired when |SCardReleaseContext| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
   */
  export interface ReleaseContextRequestedEvent {
    requestId: string;
    contextId: number;
  }
  /**
   * Fired when |SCardSetAttrib| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
   */
  export interface SetAttribRequestedEvent {
    requestId: string;
    handle: number;
    attribId: number;
    data: string;
  }
  /**
   * Fired when |SCardStatus| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
   */
  export interface StatusRequestedEvent {
    requestId: string;
    handle: number;
  }
  /**
   * Fired when |SCardTransmit| is called.
   * 
   * This maps to:
   * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
   * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
   */
  export interface TransmitRequestedEvent {
    requestId: string;
    handle: number;
    data: string;
    protocol?: SmartCardEmulation.Protocol;
  }
}

/**
 * Storage
 * @experimental
 */
export namespace Storage {
  /** Enum of interest group access types. */
  export type InterestGroupAccessType = "join" | "leave" | "update" | "loaded" | "bid" | "win" | "additionalBid" | "additionalBidWin" | "topLevelBid" | "topLevelAdditionalBid" | "clear";
  /** Enum of auction events. */
  export type InterestGroupAuctionEventType = "started" | "configResolved";
  /** Enum of network fetches auctions can do. */
  export type InterestGroupAuctionFetchType = "bidderJs" | "bidderWasm" | "sellerJs" | "bidderTrustedSignals" | "sellerTrustedSignals";
  /** Protected audience interest group auction identifier. */
  export type InterestGroupAuctionId = string;
  /**
   * A single Related Website Set object.
   * @experimental
   */
  export interface RelatedWebsiteSet {
    primarySites: string[];
    associatedSites: string[];
    serviceSites: string[];
  }
  export type SerializedStorageKey = string;
  /** Enum of shared storage access methods. */
  export type SharedStorageAccessMethod = "addModule" | "createWorklet" | "selectURL" | "run" | "batchUpdate" | "set" | "append" | "delete" | "clear" | "get" | "keys" | "values" | "entries" | "length" | "remainingBudget";
  /**
   * Bundles the parameters for shared storage access events whose
   * presence/absence can vary according to SharedStorageAccessType.
   */
  export interface SharedStorageAccessParams {
    scriptSourceUrl?: string;
    dataOrigin?: string;
    operationName?: string;
    operationId?: string;
    keepAlive?: boolean;
    privateAggregationConfig?: Storage.SharedStoragePrivateAggregationConfig;
    serializedData?: string;
    urlsWithMetadata?: Storage.SharedStorageUrlWithMetadata[];
    urnUuid?: string;
    key?: string;
    value?: string;
    ignoreIfPresent?: boolean;
    workletOrdinal?: number;
    workletTargetId?: Target.TargetID;
    withLock?: string;
    batchUpdateId?: string;
    batchSize?: number;
  }
  /** Enum of shared storage access scopes. */
  export type SharedStorageAccessScope = "window" | "sharedStorageWorklet" | "protectedAudienceWorklet" | "header";
  /** Struct for a single key-value pair in an origin's shared storage. */
  export interface SharedStorageEntry {
    key: string;
    value: string;
  }
  /** Details for an origin's shared storage. */
  export interface SharedStorageMetadata {
    creationTime: Network.TimeSinceEpoch;
    length: number;
    remainingBudget: number;
    bytesUsed: number;
  }
  /**
   * Represents a dictionary object passed in as privateAggregationConfig to
   * run or selectURL.
   */
  export interface SharedStoragePrivateAggregationConfig {
    aggregationCoordinatorOrigin?: string;
    contextId?: string;
    filteringIdMaxBytes: number;
    maxContributions?: number;
  }
  /** Pair of reporting metadata details for a candidate URL for `selectURL()`. */
  export interface SharedStorageReportingMetadata {
    eventType: string;
    reportingUrl: string;
  }
  /** Bundles a candidate URL with its reporting metadata. */
  export interface SharedStorageUrlWithMetadata {
    url: string;
    reportingMetadata: Storage.SharedStorageReportingMetadata[];
  }
  export interface StorageBucket {
    storageKey: Storage.SerializedStorageKey;
    name?: string;
  }
  export interface StorageBucketInfo {
    bucket: Storage.StorageBucket;
    id: string;
    expiration: Network.TimeSinceEpoch;
    quota: number;
    persistent: boolean;
    durability: Storage.StorageBucketsDurability;
  }
  export type StorageBucketsDurability = "relaxed" | "strict";
  /** Enum of possible storage types. */
  export type StorageType = "cookies" | "file_systems" | "indexeddb" | "local_storage" | "shader_cache" | "websql" | "service_workers" | "cache_storage" | "interest_groups" | "shared_storage" | "storage_buckets" | "all" | "other";
  /**
   * Pair of issuer origin and number of available (signed, but not used) Trust
   * Tokens from that issuer.
   * @experimental
   */
  export interface TrustTokens {
    issuerOrigin: string;
    count: number;
  }
  /** Usage for a storage type. */
  export interface UsageForType {
    storageType: Storage.StorageType;
    usage: number;
  }
  /** Clears cookies. */
  export interface ClearCookiesRequest {
    browserContextId?: Browser.BrowserContextID;
  }
  export interface ClearCookiesResponse {}
  /** Clears storage for origin. */
  export interface ClearDataForOriginRequest {
    origin: string;
    storageTypes: string;
  }
  export interface ClearDataForOriginResponse {}
  /** Clears storage for storage key. */
  export interface ClearDataForStorageKeyRequest {
    storageKey: string;
    storageTypes: string;
  }
  export interface ClearDataForStorageKeyResponse {}
  /**
   * Clears all entries for a given origin's shared storage.
   * @experimental
   */
  export interface ClearSharedStorageEntriesRequest {
    ownerOrigin: string;
  }
  export interface ClearSharedStorageEntriesResponse {}
  /**
   * Removes all Trust Tokens issued by the provided issuerOrigin.
   * Leaves other stored data, including the issuer's Redemption Records, intact.
   * @experimental
   */
  export interface ClearTrustTokensRequest {
    issuerOrigin: string;
  }
  export interface ClearTrustTokensResponse {
    didDeleteTokens: boolean;
  }
  /**
   * Deletes entry for `key` (if it exists) for a given origin's shared storage.
   * @experimental
   */
  export interface DeleteSharedStorageEntryRequest {
    ownerOrigin: string;
    key: string;
  }
  export interface DeleteSharedStorageEntryResponse {}
  /**
   * Deletes the Storage Bucket with the given storage key and bucket name.
   * @experimental
   */
  export interface DeleteStorageBucketRequest {
    bucket: Storage.StorageBucket;
  }
  export interface DeleteStorageBucketResponse {}
  /** Returns all browser cookies. */
  export interface GetCookiesRequest {
    browserContextId?: Browser.BrowserContextID;
  }
  export interface GetCookiesResponse {
    cookies: Network.Cookie[];
  }
  /**
   * Gets details for a named interest group.
   * @experimental
   */
  export interface GetInterestGroupDetailsRequest {
    ownerOrigin: string;
    name: string;
  }
  export interface GetInterestGroupDetailsResponse {
    details: Record<string, unknown>;
  }
  /**
   * Returns the effective Related Website Sets in use by this profile for the browser
   * session. The effective Related Website Sets will not change during a browser session.
   * @experimental
   */
  export interface GetRelatedWebsiteSetsRequest {}
  export interface GetRelatedWebsiteSetsResponse {
    sets: Storage.RelatedWebsiteSet[];
  }
  /**
   * Gets the entries in an given origin's shared storage.
   * @experimental
   */
  export interface GetSharedStorageEntriesRequest {
    ownerOrigin: string;
  }
  export interface GetSharedStorageEntriesResponse {
    entries: Storage.SharedStorageEntry[];
  }
  /**
   * Gets metadata for an origin's shared storage.
   * @experimental
   */
  export interface GetSharedStorageMetadataRequest {
    ownerOrigin: string;
  }
  export interface GetSharedStorageMetadataResponse {
    metadata: Storage.SharedStorageMetadata;
  }
  /**
   * Returns storage key for the given frame. If no frame ID is provided,
   * the storage key of the target executing this command is returned.
   * @experimental
   */
  export interface GetStorageKeyRequest {
    frameId?: Page.FrameId;
  }
  export interface GetStorageKeyResponse {
    storageKey: Storage.SerializedStorageKey;
  }
  /**
   * Returns a storage key given a frame id.
   * Deprecated. Please use Storage.getStorageKey instead.
   * @deprecated
   */
  export interface GetStorageKeyForFrameRequest {
    frameId: Page.FrameId;
  }
  export interface GetStorageKeyForFrameResponse {
    storageKey: Storage.SerializedStorageKey;
  }
  /**
   * Returns the number of stored Trust Tokens per issuer for the
   * current browsing context.
   * @experimental
   */
  export interface GetTrustTokensRequest {}
  export interface GetTrustTokensResponse {
    tokens: Storage.TrustTokens[];
  }
  /** Returns usage and quota in bytes. */
  export interface GetUsageAndQuotaRequest {
    origin: string;
  }
  export interface GetUsageAndQuotaResponse {
    usage: number;
    quota: number;
    overrideActive: boolean;
    usageBreakdown: Storage.UsageForType[];
  }
  /**
   * Override quota for the specified origin
   * @experimental
   */
  export interface OverrideQuotaForOriginRequest {
    origin: string;
    quotaSize?: number;
  }
  export interface OverrideQuotaForOriginResponse {}
  /**
   * Resets the budget for `ownerOrigin` by clearing all budget withdrawals.
   * @experimental
   */
  export interface ResetSharedStorageBudgetRequest {
    ownerOrigin: string;
  }
  export interface ResetSharedStorageBudgetResponse {}
  /**
   * Deletes state for sites identified as potential bounce trackers, immediately.
   * @experimental
   */
  export interface RunBounceTrackingMitigationsRequest {}
  export interface RunBounceTrackingMitigationsResponse {
    deletedSites: string[];
  }
  /** Sets given cookies. */
  export interface SetCookiesRequest {
    cookies: Network.CookieParam[];
    browserContextId?: Browser.BrowserContextID;
  }
  export interface SetCookiesResponse {}
  /**
   * Enables/Disables issuing of interestGroupAuctionEventOccurred and
   * interestGroupAuctionNetworkRequestCreated.
   * @experimental
   */
  export interface SetInterestGroupAuctionTrackingRequest {
    enable: boolean;
  }
  export interface SetInterestGroupAuctionTrackingResponse {}
  /**
   * Enables/Disables issuing of interestGroupAccessed events.
   * @experimental
   */
  export interface SetInterestGroupTrackingRequest {
    enable: boolean;
  }
  export interface SetInterestGroupTrackingResponse {}
  export interface SetProtectedAudienceKAnonymityRequest {
    owner: string;
    name: string;
    hashes: string[];
  }
  export interface SetProtectedAudienceKAnonymityResponse {}
  /**
   * Sets entry with `key` and `value` for a given origin's shared storage.
   * @experimental
   */
  export interface SetSharedStorageEntryRequest {
    ownerOrigin: string;
    key: string;
    value: string;
    ignoreIfPresent?: boolean;
  }
  export interface SetSharedStorageEntryResponse {}
  /**
   * Enables/disables issuing of sharedStorageAccessed events.
   * @experimental
   */
  export interface SetSharedStorageTrackingRequest {
    enable: boolean;
  }
  export interface SetSharedStorageTrackingResponse {}
  /**
   * Set tracking for a storage key's buckets.
   * @experimental
   */
  export interface SetStorageBucketTrackingRequest {
    storageKey: string;
    enable: boolean;
  }
  export interface SetStorageBucketTrackingResponse {}
  /** Registers origin to be notified when an update occurs to its cache storage list. */
  export interface TrackCacheStorageForOriginRequest {
    origin: string;
  }
  export interface TrackCacheStorageForOriginResponse {}
  /** Registers storage key to be notified when an update occurs to its cache storage list. */
  export interface TrackCacheStorageForStorageKeyRequest {
    storageKey: string;
  }
  export interface TrackCacheStorageForStorageKeyResponse {}
  /** Registers origin to be notified when an update occurs to its IndexedDB. */
  export interface TrackIndexedDBForOriginRequest {
    origin: string;
  }
  export interface TrackIndexedDBForOriginResponse {}
  /** Registers storage key to be notified when an update occurs to its IndexedDB. */
  export interface TrackIndexedDBForStorageKeyRequest {
    storageKey: string;
  }
  export interface TrackIndexedDBForStorageKeyResponse {}
  /** Unregisters origin from receiving notifications for cache storage. */
  export interface UntrackCacheStorageForOriginRequest {
    origin: string;
  }
  export interface UntrackCacheStorageForOriginResponse {}
  /** Unregisters storage key from receiving notifications for cache storage. */
  export interface UntrackCacheStorageForStorageKeyRequest {
    storageKey: string;
  }
  export interface UntrackCacheStorageForStorageKeyResponse {}
  /** Unregisters origin from receiving notifications for IndexedDB. */
  export interface UntrackIndexedDBForOriginRequest {
    origin: string;
  }
  export interface UntrackIndexedDBForOriginResponse {}
  /** Unregisters storage key from receiving notifications for IndexedDB. */
  export interface UntrackIndexedDBForStorageKeyRequest {
    storageKey: string;
  }
  export interface UntrackIndexedDBForStorageKeyResponse {}
  /** A cache's contents have been modified. */
  export interface CacheStorageContentUpdatedEvent {
    origin: string;
    storageKey: string;
    bucketId: string;
    cacheName: string;
  }
  /** A cache has been added/deleted. */
  export interface CacheStorageListUpdatedEvent {
    origin: string;
    storageKey: string;
    bucketId: string;
  }
  /** The origin's IndexedDB object store has been modified. */
  export interface IndexedDBContentUpdatedEvent {
    origin: string;
    storageKey: string;
    bucketId: string;
    databaseName: string;
    objectStoreName: string;
  }
  /** The origin's IndexedDB database list has been modified. */
  export interface IndexedDBListUpdatedEvent {
    origin: string;
    storageKey: string;
    bucketId: string;
  }
  /**
   * One of the interest groups was accessed. Note that these events are global
   * to all targets sharing an interest group store.
   */
  export interface InterestGroupAccessedEvent {
    accessTime: Network.TimeSinceEpoch;
    type: Storage.InterestGroupAccessType;
    ownerOrigin: string;
    name: string;
    componentSellerOrigin?: string;
    bid?: number;
    bidCurrency?: string;
    uniqueAuctionId?: Storage.InterestGroupAuctionId;
  }
  /**
   * An auction involving interest groups is taking place. These events are
   * target-specific.
   */
  export interface InterestGroupAuctionEventOccurredEvent {
    eventTime: Network.TimeSinceEpoch;
    type: Storage.InterestGroupAuctionEventType;
    uniqueAuctionId: Storage.InterestGroupAuctionId;
    parentAuctionId?: Storage.InterestGroupAuctionId;
    auctionConfig?: Record<string, unknown>;
  }
  /**
   * Specifies which auctions a particular network fetch may be related to, and
   * in what role. Note that it is not ordered with respect to
   * Network.requestWillBeSent (but will happen before loadingFinished
   * loadingFailed).
   */
  export interface InterestGroupAuctionNetworkRequestCreatedEvent {
    type: Storage.InterestGroupAuctionFetchType;
    requestId: Network.RequestId;
    auctions: Storage.InterestGroupAuctionId[];
  }
  /**
   * Shared storage was accessed by the associated page.
   * The following parameters are included in all events.
   */
  export interface SharedStorageAccessedEvent {
    accessTime: Network.TimeSinceEpoch;
    scope: Storage.SharedStorageAccessScope;
    method: Storage.SharedStorageAccessMethod;
    mainFrameId: Page.FrameId;
    ownerOrigin: string;
    ownerSite: string;
    params: Storage.SharedStorageAccessParams;
  }
  /**
   * A shared storage run or selectURL operation finished its execution.
   * The following parameters are included in all events.
   */
  export interface SharedStorageWorkletOperationExecutionFinishedEvent {
    finishedTime: Network.TimeSinceEpoch;
    executionTime: number;
    method: Storage.SharedStorageAccessMethod;
    operationId: string;
    workletTargetId: Target.TargetID;
    mainFrameId: Page.FrameId;
    ownerOrigin: string;
  }
  export interface StorageBucketCreatedOrUpdatedEvent {
    bucketInfo: Storage.StorageBucketInfo;
  }
  export interface StorageBucketDeletedEvent {
    bucketId: string;
  }
}

/**
 * The SystemInfo domain defines methods and events for querying low-level system information.
 * @experimental
 */
export namespace SystemInfo {
  /** Describes a single graphics processor (GPU). */
  export interface GPUDevice {
    vendorId: number;
    deviceId: number;
    subSysId?: number;
    revision?: number;
    vendorString: string;
    deviceString: string;
    driverVendor: string;
    driverVersion: string;
  }
  /** Provides information about the GPU(s) on the system. */
  export interface GPUInfo {
    devices: SystemInfo.GPUDevice[];
    auxAttributes?: Record<string, unknown>;
    featureStatus?: Record<string, unknown>;
    driverBugWorkarounds: string[];
    videoDecoding: SystemInfo.VideoDecodeAcceleratorCapability[];
    videoEncoding: SystemInfo.VideoEncodeAcceleratorCapability[];
  }
  /** Image format of a given image. */
  export type ImageType = "jpeg" | "webp" | "unknown";
  /** Represents process info. */
  export interface ProcessInfo {
    type: string;
    id: number;
    cpuTime: number;
  }
  /** Describes the width and height dimensions of an entity. */
  export interface Size {
    width: number;
    height: number;
  }
  /** YUV subsampling type of the pixels of a given image. */
  export type SubsamplingFormat = "yuv420" | "yuv422" | "yuv444";
  /**
   * Describes a supported video decoding profile with its associated minimum and
   * maximum resolutions.
   */
  export interface VideoDecodeAcceleratorCapability {
    profile: string;
    maxResolution: SystemInfo.Size;
    minResolution: SystemInfo.Size;
  }
  /**
   * Describes a supported video encoding profile with its associated maximum
   * resolution and maximum framerate.
   */
  export interface VideoEncodeAcceleratorCapability {
    profile: string;
    maxResolution: SystemInfo.Size;
    maxFramerateNumerator: number;
    maxFramerateDenominator: number;
  }
  /** Returns information about the feature state. */
  export interface GetFeatureStateRequest {
    featureState: string;
  }
  export interface GetFeatureStateResponse {
    featureEnabled: boolean;
  }
  /** Returns information about the system. */
  export interface GetInfoRequest {}
  export interface GetInfoResponse {
    gpu: SystemInfo.GPUInfo;
    modelName: string;
    modelVersion: string;
    commandLine: string;
  }
  /** Returns information about all running processes. */
  export interface GetProcessInfoRequest {}
  export interface GetProcessInfoResponse {
    processInfo: SystemInfo.ProcessInfo[];
  }
}

/**
 * Supports additional targets discovery and allows to attach to them.
 */
export namespace Target {
  /**
   * A filter used by target query/discovery/auto-attach operations.
   * @experimental
   */
  export interface FilterEntry {
    exclude?: boolean;
    type?: string;
  }
  /** @experimental */
  export interface RemoteLocation {
    host: string;
    port: number;
  }
  /** Unique identifier of attached debugging session. */
  export type SessionID = string;
  /**
   * The entries in TargetFilter are matched sequentially against targets and
   * the first entry that matches determines if the target is included or not,
   * depending on the value of `exclude` field in the entry.
   * If filter is not specified, the one assumed is
   * [{type: "browser", exclude: true}, {type: "tab", exclude: true}, {}]
   * (i.e. include everything but `browser` and `tab`).
   * @experimental
   */
  export type TargetFilter = Target.FilterEntry[];
  export type TargetID = string;
  export interface TargetInfo {
    targetId: Target.TargetID;
    type: string;
    title: string;
    url: string;
    attached: boolean;
    parentId?: Target.TargetID;
    openerId?: Target.TargetID;
    canAccessOpener: boolean;
    openerFrameId?: Page.FrameId;
    parentFrameId?: Page.FrameId;
    browserContextId?: Browser.BrowserContextID;
    subtype?: string;
  }
  /**
   * The state of the target window.
   * @experimental
   */
  export type WindowState = "normal" | "minimized" | "maximized" | "fullscreen";
  /** Activates (focuses) the target. */
  export interface ActivateTargetRequest {
    targetId: Target.TargetID;
  }
  export interface ActivateTargetResponse {}
  /**
   * Attaches to the browser target, only uses flat sessionId mode.
   * @experimental
   */
  export interface AttachToBrowserTargetRequest {}
  export interface AttachToBrowserTargetResponse {
    sessionId: Target.SessionID;
  }
  /** Attaches to the target with given id. */
  export interface AttachToTargetRequest {
    targetId: Target.TargetID;
    flatten?: boolean;
  }
  export interface AttachToTargetResponse {
    sessionId: Target.SessionID;
  }
  /**
   * Adds the specified target to the list of targets that will be monitored for any related target
   * creation (such as child frames, child workers and new versions of service worker) and reported
   * through `attachedToTarget`. The specified target is also auto-attached.
   * This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
   * `setAutoAttach`. Only available at the Browser target.
   * @experimental
   */
  export interface AutoAttachRelatedRequest {
    targetId: Target.TargetID;
    waitForDebuggerOnStart: boolean;
    filter?: Target.TargetFilter;
  }
  export interface AutoAttachRelatedResponse {}
  /** Closes the target. If the target is a page that gets closed too. */
  export interface CloseTargetRequest {
    targetId: Target.TargetID;
  }
  export interface CloseTargetResponse {
    success: boolean;
  }
  /**
   * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
   * one.
   */
  export interface CreateBrowserContextRequest {
    disposeOnDetach?: boolean;
    proxyServer?: string;
    proxyBypassList?: string;
    originsWithUniversalNetworkAccess?: string[];
  }
  export interface CreateBrowserContextResponse {
    browserContextId: Browser.BrowserContextID;
  }
  /** Creates a new page. */
  export interface CreateTargetRequest {
    url: string;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    windowState?: Target.WindowState;
    browserContextId?: Browser.BrowserContextID;
    enableBeginFrameControl?: boolean;
    newWindow?: boolean;
    background?: boolean;
    forTab?: boolean;
    hidden?: boolean;
    focus?: boolean;
  }
  export interface CreateTargetResponse {
    targetId: Target.TargetID;
  }
  /** Detaches session with given id. */
  export interface DetachFromTargetRequest {
    sessionId?: Target.SessionID;
    targetId?: Target.TargetID;
  }
  export interface DetachFromTargetResponse {}
  /**
   * Deletes a BrowserContext. All the belonging pages will be closed without calling their
   * beforeunload hooks.
   */
  export interface DisposeBrowserContextRequest {
    browserContextId: Browser.BrowserContextID;
  }
  export interface DisposeBrowserContextResponse {}
  /**
   * Inject object to the target's main frame that provides a communication
   * channel with browser target.
   * 
   * Injected object will be available as `window[bindingName]`.
   * 
   * The object has the following API:
   * - `binding.send(json)` - a method to send messages over the remote debugging protocol
   * - `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.
   * @experimental
   */
  export interface ExposeDevToolsProtocolRequest {
    targetId: Target.TargetID;
    bindingName?: string;
    inheritPermissions?: boolean;
  }
  export interface ExposeDevToolsProtocolResponse {}
  /** Returns all browser contexts created with `Target.createBrowserContext` method. */
  export interface GetBrowserContextsRequest {}
  export interface GetBrowserContextsResponse {
    browserContextIds: Browser.BrowserContextID[];
    defaultBrowserContextId?: Browser.BrowserContextID;
  }
  /**
   * Gets the targetId of the DevTools page target opened for the given target
   * (if any).
   * @experimental
   */
  export interface GetDevToolsTargetRequest {
    targetId: Target.TargetID;
  }
  export interface GetDevToolsTargetResponse {
    targetId?: Target.TargetID;
  }
  /**
   * Returns information about a target.
   * @experimental
   */
  export interface GetTargetInfoRequest {
    targetId?: Target.TargetID;
  }
  export interface GetTargetInfoResponse {
    targetInfo: Target.TargetInfo;
  }
  /** Retrieves a list of available targets. */
  export interface GetTargetsRequest {
    filter?: Target.TargetFilter;
  }
  export interface GetTargetsResponse {
    targetInfos: Target.TargetInfo[];
  }
  /**
   * Opens a DevTools window for the target.
   * @experimental
   */
  export interface OpenDevToolsRequest {
    targetId: Target.TargetID;
    panelId?: string;
  }
  export interface OpenDevToolsResponse {
    targetId: Target.TargetID;
  }
  /**
   * Sends protocol message over session with given id.
   * Consider using flat mode instead; see commands attachToTarget, setAutoAttach,
   * and crbug.com/991325.
   * @deprecated
   */
  export interface SendMessageToTargetRequest {
    message: string;
    sessionId?: Target.SessionID;
    targetId?: Target.TargetID;
  }
  export interface SendMessageToTargetResponse {}
  /**
   * Controls whether to automatically attach to new targets which are considered
   * to be directly related to this one (for example, iframes or workers).
   * When turned on, attaches to all existing related targets as well. When turned off,
   * automatically detaches from all currently attached targets.
   * This also clears all targets added by `autoAttachRelated` from the list of targets to watch
   * for creation of related targets.
   * You might want to call this recursively for auto-attached targets to attach
   * to all available targets.
   */
  export interface SetAutoAttachRequest {
    autoAttach: boolean;
    waitForDebuggerOnStart: boolean;
    flatten?: boolean;
    filter?: Target.TargetFilter;
  }
  export interface SetAutoAttachResponse {}
  /**
   * Controls whether to discover available targets and notify via
   * `targetCreated/targetInfoChanged/targetDestroyed` events.
   */
  export interface SetDiscoverTargetsRequest {
    discover: boolean;
    filter?: Target.TargetFilter;
  }
  export interface SetDiscoverTargetsResponse {}
  /**
   * Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
   * `true`.
   * @experimental
   */
  export interface SetRemoteLocationsRequest {
    locations: Target.RemoteLocation[];
  }
  export interface SetRemoteLocationsResponse {}
  /**
   * Issued when attached to target because of auto-attach or `attachToTarget` command.
   * @experimental
   */
  export interface AttachedToTargetEvent {
    sessionId: Target.SessionID;
    targetInfo: Target.TargetInfo;
    waitingForDebugger: boolean;
  }
  /**
   * Issued when detached from target for any reason (including `detachFromTarget` command). Can be
   * issued multiple times per target if multiple sessions have been attached to it.
   * @experimental
   */
  export interface DetachedFromTargetEvent {
    sessionId: Target.SessionID;
    targetId?: Target.TargetID;
  }
  /**
   * Notifies about a new protocol message received from the session (as reported in
   * `attachedToTarget` event).
   */
  export interface ReceivedMessageFromTargetEvent {
    sessionId: Target.SessionID;
    message: string;
    targetId?: Target.TargetID;
  }
  /** Issued when a target has crashed. */
  export interface TargetCrashedEvent {
    targetId: Target.TargetID;
    status: string;
    errorCode: number;
  }
  /** Issued when a possible inspection target is created. */
  export interface TargetCreatedEvent {
    targetInfo: Target.TargetInfo;
  }
  /** Issued when a target is destroyed. */
  export interface TargetDestroyedEvent {
    targetId: Target.TargetID;
  }
  /**
   * Issued when some information about a target has changed. This only happens between
   * `targetCreated` and `targetDestroyed`.
   */
  export interface TargetInfoChangedEvent {
    targetInfo: Target.TargetInfo;
  }
}

/**
 * The Tethering domain defines methods and events for browser port binding.
 * @experimental
 */
export namespace Tethering {
  /** Request browser port binding. */
  export interface BindRequest {
    port: number;
  }
  export interface BindResponse {}
  /** Request browser port unbinding. */
  export interface UnbindRequest {
    port: number;
  }
  export interface UnbindResponse {}
  /** Informs that port was successfully bound and got a specified connection id. */
  export interface AcceptedEvent {
    port: number;
    connectionId: string;
  }
}

export namespace Tracing {
  /**
   * Configuration for memory dump. Used only when "memory-infra" category is enabled.
   * @experimental
   */
  export type MemoryDumpConfig = Record<string, unknown>;
  /**
   * Details exposed when memory request explicitly declared.
   * Keep consistent with memory_dump_request_args.h and
   * memory_instrumentation.mojom
   * @experimental
   */
  export type MemoryDumpLevelOfDetail = "background" | "light" | "detailed";
  /**
   * Compression type to use for traces returned via streams.
   * @experimental
   */
  export type StreamCompression = "none" | "gzip";
  /**
   * Data format of a trace. Can be either the legacy JSON format or the
   * protocol buffer format. Note that the JSON format will be deprecated soon.
   * @experimental
   */
  export type StreamFormat = "json" | "proto";
  export interface TraceConfig {
    recordMode?: "recordUntilFull" | "recordContinuously" | "recordAsMuchAsPossible" | "echoToConsole";
    traceBufferSizeInKb?: number;
    enableSampling?: boolean;
    enableSystrace?: boolean;
    enableArgumentFilter?: boolean;
    includedCategories?: string[];
    excludedCategories?: string[];
    syntheticDelays?: string[];
    memoryDumpConfig?: Tracing.MemoryDumpConfig;
  }
  /**
   * Backend type to use for tracing. `chrome` uses the Chrome-integrated
   * tracing service and is supported on all platforms. `system` is only
   * supported on Chrome OS and uses the Perfetto system tracing service.
   * `auto` chooses `system` when the perfettoConfig provided to Tracing.start
   * specifies at least one non-Chrome data source; otherwise uses `chrome`.
   * @experimental
   */
  export type TracingBackend = "auto" | "chrome" | "system";
  /** Stop trace events collection. */
  export interface EndRequest {}
  export interface EndResponse {}
  /**
   * Gets supported tracing categories.
   * @experimental
   */
  export interface GetCategoriesRequest {}
  export interface GetCategoriesResponse {
    categories: string[];
  }
  /**
   * Return a descriptor for all available tracing categories.
   * @experimental
   */
  export interface GetTrackEventDescriptorRequest {}
  export interface GetTrackEventDescriptorResponse {
    descriptor: string;
  }
  /**
   * Record a clock sync marker in the trace.
   * @experimental
   */
  export interface RecordClockSyncMarkerRequest {
    syncId: string;
  }
  export interface RecordClockSyncMarkerResponse {}
  /**
   * Request a global memory dump.
   * @experimental
   */
  export interface RequestMemoryDumpRequest {
    deterministic?: boolean;
    levelOfDetail?: Tracing.MemoryDumpLevelOfDetail;
  }
  export interface RequestMemoryDumpResponse {
    dumpGuid: string;
    success: boolean;
  }
  /** Start trace events collection. */
  export interface StartRequest {
    categories?: string;
    options?: string;
    bufferUsageReportingInterval?: number;
    transferMode?: "ReportEvents" | "ReturnAsStream";
    streamFormat?: Tracing.StreamFormat;
    streamCompression?: Tracing.StreamCompression;
    traceConfig?: Tracing.TraceConfig;
    perfettoConfig?: string;
    tracingBackend?: Tracing.TracingBackend;
  }
  export interface StartResponse {}
  /** @experimental */
  export interface BufferUsageEvent {
    percentFull?: number;
    eventCount?: number;
    value?: number;
  }
  /**
   * Contains a bucket of collected trace events. When tracing is stopped collected events will be
   * sent as a sequence of dataCollected events followed by tracingComplete event.
   * @experimental
   */
  export interface DataCollectedEvent {
    value: Record<string, unknown>[];
  }
  /**
   * Signals that tracing is stopped and there is no trace buffers pending flush, all data were
   * delivered via dataCollected events.
   */
  export interface TracingCompleteEvent {
    dataLossOccurred: boolean;
    stream?: IO.StreamHandle;
    traceFormat?: Tracing.StreamFormat;
    streamCompression?: Tracing.StreamCompression;
  }
}

/**
 * This domain allows inspection of Web Audio API.
https://webaudio.github.io/web-audio-api/
 * @experimental
 */
export namespace WebAudio {
  /** Protocol object for AudioListener */
  export interface AudioListener {
    listenerId: WebAudio.GraphObjectId;
    contextId: WebAudio.GraphObjectId;
  }
  /** Protocol object for AudioNode */
  export interface AudioNode {
    nodeId: WebAudio.GraphObjectId;
    contextId: WebAudio.GraphObjectId;
    nodeType: WebAudio.NodeType;
    numberOfInputs: number;
    numberOfOutputs: number;
    channelCount: number;
    channelCountMode: WebAudio.ChannelCountMode;
    channelInterpretation: WebAudio.ChannelInterpretation;
  }
  /** Protocol object for AudioParam */
  export interface AudioParam {
    paramId: WebAudio.GraphObjectId;
    nodeId: WebAudio.GraphObjectId;
    contextId: WebAudio.GraphObjectId;
    paramType: WebAudio.ParamType;
    rate: WebAudio.AutomationRate;
    defaultValue: number;
    minValue: number;
    maxValue: number;
  }
  /** Enum of AudioParam::AutomationRate from the spec */
  export type AutomationRate = "a-rate" | "k-rate";
  /** Protocol object for BaseAudioContext */
  export interface BaseAudioContext {
    contextId: WebAudio.GraphObjectId;
    contextType: WebAudio.ContextType;
    contextState: WebAudio.ContextState;
    realtimeData?: WebAudio.ContextRealtimeData;
    callbackBufferSize: number;
    maxOutputChannelCount: number;
    sampleRate: number;
  }
  /** Enum of AudioNode::ChannelCountMode from the spec */
  export type ChannelCountMode = "clamped-max" | "explicit" | "max";
  /** Enum of AudioNode::ChannelInterpretation from the spec */
  export type ChannelInterpretation = "discrete" | "speakers";
  /** Fields in AudioContext that change in real-time. */
  export interface ContextRealtimeData {
    currentTime: number;
    renderCapacity: number;
    callbackIntervalMean: number;
    callbackIntervalVariance: number;
  }
  /** Enum of AudioContextState from the spec */
  export type ContextState = "suspended" | "running" | "closed" | "interrupted";
  /** Enum of BaseAudioContext types */
  export type ContextType = "realtime" | "offline";
  /** An unique ID for a graph object (AudioContext, AudioNode, AudioParam) in Web Audio API */
  export type GraphObjectId = string;
  /** Enum of AudioNode types */
  export type NodeType = string;
  /** Enum of AudioParam types */
  export type ParamType = string;
  /** Disables the WebAudio domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /** Enables the WebAudio domain and starts sending context lifetime events. */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Fetch the realtime data from the registered contexts. */
  export interface GetRealtimeDataRequest {
    contextId: WebAudio.GraphObjectId;
  }
  export interface GetRealtimeDataResponse {
    realtimeData: WebAudio.ContextRealtimeData;
  }
  /** Notifies that the construction of an AudioListener has finished. */
  export interface AudioListenerCreatedEvent {
    listener: WebAudio.AudioListener;
  }
  /** Notifies that a new AudioListener has been created. */
  export interface AudioListenerWillBeDestroyedEvent {
    contextId: WebAudio.GraphObjectId;
    listenerId: WebAudio.GraphObjectId;
  }
  /** Notifies that a new AudioNode has been created. */
  export interface AudioNodeCreatedEvent {
    node: WebAudio.AudioNode;
  }
  /** Notifies that an existing AudioNode has been destroyed. */
  export interface AudioNodeWillBeDestroyedEvent {
    contextId: WebAudio.GraphObjectId;
    nodeId: WebAudio.GraphObjectId;
  }
  /** Notifies that a new AudioParam has been created. */
  export interface AudioParamCreatedEvent {
    param: WebAudio.AudioParam;
  }
  /** Notifies that an existing AudioParam has been destroyed. */
  export interface AudioParamWillBeDestroyedEvent {
    contextId: WebAudio.GraphObjectId;
    nodeId: WebAudio.GraphObjectId;
    paramId: WebAudio.GraphObjectId;
  }
  /** Notifies that existing BaseAudioContext has changed some properties (id stays the same).. */
  export interface ContextChangedEvent {
    context: WebAudio.BaseAudioContext;
  }
  /** Notifies that a new BaseAudioContext has been created. */
  export interface ContextCreatedEvent {
    context: WebAudio.BaseAudioContext;
  }
  /** Notifies that an existing BaseAudioContext will be destroyed. */
  export interface ContextWillBeDestroyedEvent {
    contextId: WebAudio.GraphObjectId;
  }
  /** Notifies that an AudioNode is connected to an AudioParam. */
  export interface NodeParamConnectedEvent {
    contextId: WebAudio.GraphObjectId;
    sourceId: WebAudio.GraphObjectId;
    destinationId: WebAudio.GraphObjectId;
    sourceOutputIndex?: number;
  }
  /** Notifies that an AudioNode is disconnected to an AudioParam. */
  export interface NodeParamDisconnectedEvent {
    contextId: WebAudio.GraphObjectId;
    sourceId: WebAudio.GraphObjectId;
    destinationId: WebAudio.GraphObjectId;
    sourceOutputIndex?: number;
  }
  /** Notifies that two AudioNodes are connected. */
  export interface NodesConnectedEvent {
    contextId: WebAudio.GraphObjectId;
    sourceId: WebAudio.GraphObjectId;
    destinationId: WebAudio.GraphObjectId;
    sourceOutputIndex?: number;
    destinationInputIndex?: number;
  }
  /** Notifies that AudioNodes are disconnected. The destination can be null, and it means all the outgoing connections from the source are disconnected. */
  export interface NodesDisconnectedEvent {
    contextId: WebAudio.GraphObjectId;
    sourceId: WebAudio.GraphObjectId;
    destinationId: WebAudio.GraphObjectId;
    sourceOutputIndex?: number;
    destinationInputIndex?: number;
  }
}

/**
 * This domain allows configuring virtual authenticators to test the WebAuthn
API.
 * @experimental
 */
export namespace WebAuthn {
  export type AuthenticatorId = string;
  export type AuthenticatorProtocol = "u2f" | "ctap2";
  export type AuthenticatorTransport = "usb" | "nfc" | "ble" | "cable" | "internal";
  export interface Credential {
    credentialId: string;
    isResidentCredential: boolean;
    rpId?: string;
    privateKey: string;
    userHandle?: string;
    signCount: number;
    largeBlob?: string;
    backupEligibility?: boolean;
    backupState?: boolean;
    userName?: string;
    userDisplayName?: string;
  }
  export type Ctap2Version = "ctap2_0" | "ctap2_1" | "ctap2_2";
  export interface VirtualAuthenticatorOptions {
    protocol: WebAuthn.AuthenticatorProtocol;
    ctap2Version?: WebAuthn.Ctap2Version;
    transport: WebAuthn.AuthenticatorTransport;
    hasResidentKey?: boolean;
    hasUserVerification?: boolean;
    hasLargeBlob?: boolean;
    hasCredBlob?: boolean;
    hasMinPinLength?: boolean;
    hasPrf?: boolean;
    hasHmacSecret?: boolean;
    hasHmacSecretMc?: boolean;
    automaticPresenceSimulation?: boolean;
    isUserVerified?: boolean;
    defaultBackupEligibility?: boolean;
    defaultBackupState?: boolean;
  }
  /** Adds the credential to the specified authenticator. */
  export interface AddCredentialRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    credential: WebAuthn.Credential;
  }
  export interface AddCredentialResponse {}
  /** Creates and adds a virtual authenticator. */
  export interface AddVirtualAuthenticatorRequest {
    options: WebAuthn.VirtualAuthenticatorOptions;
  }
  export interface AddVirtualAuthenticatorResponse {
    authenticatorId: WebAuthn.AuthenticatorId;
  }
  /** Clears all the credentials from the specified device. */
  export interface ClearCredentialsRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
  }
  export interface ClearCredentialsResponse {}
  /** Disable the WebAuthn domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enable the WebAuthn domain and start intercepting credential storage and
   * retrieval with a virtual authenticator.
   */
  export interface EnableRequest {
    enableUI?: boolean;
  }
  export interface EnableResponse {}
  /**
   * Returns a single credential stored in the given virtual authenticator that
   * matches the credential ID.
   */
  export interface GetCredentialRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    credentialId: string;
  }
  export interface GetCredentialResponse {
    credential: WebAuthn.Credential;
  }
  /** Returns all the credentials stored in the given virtual authenticator. */
  export interface GetCredentialsRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
  }
  export interface GetCredentialsResponse {
    credentials: WebAuthn.Credential[];
  }
  /** Removes a credential from the authenticator. */
  export interface RemoveCredentialRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    credentialId: string;
  }
  export interface RemoveCredentialResponse {}
  /** Removes the given authenticator. */
  export interface RemoveVirtualAuthenticatorRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
  }
  export interface RemoveVirtualAuthenticatorResponse {}
  /**
   * Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
   * The default is true.
   */
  export interface SetAutomaticPresenceSimulationRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    enabled: boolean;
  }
  export interface SetAutomaticPresenceSimulationResponse {}
  /**
   * Allows setting credential properties.
   * https://w3c.github.io/webauthn/#sctn-automation-set-credential-properties
   */
  export interface SetCredentialPropertiesRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    credentialId: string;
    backupEligibility?: boolean;
    backupState?: boolean;
  }
  export interface SetCredentialPropertiesResponse {}
  /** Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present. */
  export interface SetResponseOverrideBitsRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    isBogusSignature?: boolean;
    isBadUV?: boolean;
    isBadUP?: boolean;
  }
  export interface SetResponseOverrideBitsResponse {}
  /**
   * Sets whether User Verification succeeds or fails for an authenticator.
   * The default is true.
   */
  export interface SetUserVerifiedRequest {
    authenticatorId: WebAuthn.AuthenticatorId;
    isUserVerified: boolean;
  }
  export interface SetUserVerifiedResponse {}
  /** Triggered when a credential is added to an authenticator. */
  export interface CredentialAddedEvent {
    authenticatorId: WebAuthn.AuthenticatorId;
    credential: WebAuthn.Credential;
  }
  /** Triggered when a credential is used in a webauthn assertion. */
  export interface CredentialAssertedEvent {
    authenticatorId: WebAuthn.AuthenticatorId;
    credential: WebAuthn.Credential;
  }
  /**
   * Triggered when a credential is deleted, e.g. through
   * PublicKeyCredential.signalUnknownCredential().
   */
  export interface CredentialDeletedEvent {
    authenticatorId: WebAuthn.AuthenticatorId;
    credentialId: string;
  }
  /**
   * Triggered when a credential is updated, e.g. through
   * PublicKeyCredential.signalCurrentUserDetails().
   */
  export interface CredentialUpdatedEvent {
    authenticatorId: WebAuthn.AuthenticatorId;
    credential: WebAuthn.Credential;
  }
}

/**
 * WebMCP
 * @experimental
 */
export namespace WebMCP {
  /** Tool annotations */
  export interface Annotation {
    readOnly?: boolean;
    untrustedContent?: boolean;
    autosubmit?: boolean;
  }
  /** Represents the status of a tool invocation. */
  export type InvocationStatus = "Completed" | "Canceled" | "Error";
  /** Definition of a tool that was removed. */
  export interface RemovedTool {
    name: string;
    frameId: Page.FrameId;
  }
  /** Definition of a tool that can be invoked. */
  export interface Tool {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    annotations?: WebMCP.Annotation;
    frameId: Page.FrameId;
    backendNodeId?: DOM.BackendNodeId;
    stackTrace?: Runtime.StackTrace;
  }
  /** Cancels a pending tool invocation. */
  export interface CancelInvocationRequest {
    invocationId: string;
  }
  export interface CancelInvocationResponse {}
  /** Disables the WebMCP domain. */
  export interface DisableRequest {}
  export interface DisableResponse {}
  /**
   * Enables the WebMCP domain, allowing events to be sent. Enabling the domain will trigger a toolsAdded event for
   * all currently registered tools.
   */
  export interface EnableRequest {}
  export interface EnableResponse {}
  /** Invokes a registered tool. */
  export interface InvokeToolRequest {
    frameId: Page.FrameId;
    toolName: string;
    input: Record<string, unknown>;
  }
  export interface InvokeToolResponse {
    invocationId: string;
  }
  /** Event fired when a tool invocation starts. */
  export interface ToolInvokedEvent {
    toolName: string;
    frameId: Page.FrameId;
    invocationId: string;
    input: string;
  }
  /** Event fired when a tool invocation completes or fails. */
  export interface ToolRespondedEvent {
    invocationId: string;
    status: WebMCP.InvocationStatus;
    output?: unknown;
    errorText?: string;
    exception?: Runtime.RemoteObject;
  }
  /** Event fired when new tools are added. */
  export interface ToolsAddedEvent {
    tools: WebMCP.Tool[];
  }
  /** Event fired when tools are removed. */
  export interface ToolsRemovedEvent {
    tools: WebMCP.RemovedTool[];
  }
}

export interface CdpCommands {
  "Accessibility.disable": { params: Accessibility.DisableRequest; result: Accessibility.DisableResponse };
  "Accessibility.enable": { params: Accessibility.EnableRequest; result: Accessibility.EnableResponse };
  "Accessibility.getAXNodeAndAncestors": { params: Accessibility.GetAXNodeAndAncestorsRequest; result: Accessibility.GetAXNodeAndAncestorsResponse };
  "Accessibility.getChildAXNodes": { params: Accessibility.GetChildAXNodesRequest; result: Accessibility.GetChildAXNodesResponse };
  "Accessibility.getFullAXTree": { params: Accessibility.GetFullAXTreeRequest; result: Accessibility.GetFullAXTreeResponse };
  "Accessibility.getPartialAXTree": { params: Accessibility.GetPartialAXTreeRequest; result: Accessibility.GetPartialAXTreeResponse };
  "Accessibility.getRootAXNode": { params: Accessibility.GetRootAXNodeRequest; result: Accessibility.GetRootAXNodeResponse };
  "Accessibility.queryAXTree": { params: Accessibility.QueryAXTreeRequest; result: Accessibility.QueryAXTreeResponse };
  "Animation.disable": { params: Animation.DisableRequest; result: Animation.DisableResponse };
  "Animation.enable": { params: Animation.EnableRequest; result: Animation.EnableResponse };
  "Animation.getCurrentTime": { params: Animation.GetCurrentTimeRequest; result: Animation.GetCurrentTimeResponse };
  "Animation.getPlaybackRate": { params: Animation.GetPlaybackRateRequest; result: Animation.GetPlaybackRateResponse };
  "Animation.releaseAnimations": { params: Animation.ReleaseAnimationsRequest; result: Animation.ReleaseAnimationsResponse };
  "Animation.resolveAnimation": { params: Animation.ResolveAnimationRequest; result: Animation.ResolveAnimationResponse };
  "Animation.seekAnimations": { params: Animation.SeekAnimationsRequest; result: Animation.SeekAnimationsResponse };
  "Animation.setPaused": { params: Animation.SetPausedRequest; result: Animation.SetPausedResponse };
  "Animation.setPlaybackRate": { params: Animation.SetPlaybackRateRequest; result: Animation.SetPlaybackRateResponse };
  "Animation.setTiming": { params: Animation.SetTimingRequest; result: Animation.SetTimingResponse };
  "Audits.checkFormsIssues": { params: Audits.CheckFormsIssuesRequest; result: Audits.CheckFormsIssuesResponse };
  "Audits.disable": { params: Audits.DisableRequest; result: Audits.DisableResponse };
  "Audits.enable": { params: Audits.EnableRequest; result: Audits.EnableResponse };
  "Audits.getEncodedResponse": { params: Audits.GetEncodedResponseRequest; result: Audits.GetEncodedResponseResponse };
  "Autofill.disable": { params: Autofill.DisableRequest; result: Autofill.DisableResponse };
  "Autofill.enable": { params: Autofill.EnableRequest; result: Autofill.EnableResponse };
  "Autofill.setAddresses": { params: Autofill.SetAddressesRequest; result: Autofill.SetAddressesResponse };
  "Autofill.trigger": { params: Autofill.TriggerRequest; result: Autofill.TriggerResponse };
  "BackgroundService.clearEvents": { params: BackgroundService.ClearEventsRequest; result: BackgroundService.ClearEventsResponse };
  "BackgroundService.setRecording": { params: BackgroundService.SetRecordingRequest; result: BackgroundService.SetRecordingResponse };
  "BackgroundService.startObserving": { params: BackgroundService.StartObservingRequest; result: BackgroundService.StartObservingResponse };
  "BackgroundService.stopObserving": { params: BackgroundService.StopObservingRequest; result: BackgroundService.StopObservingResponse };
  "BluetoothEmulation.addCharacteristic": { params: BluetoothEmulation.AddCharacteristicRequest; result: BluetoothEmulation.AddCharacteristicResponse };
  "BluetoothEmulation.addDescriptor": { params: BluetoothEmulation.AddDescriptorRequest; result: BluetoothEmulation.AddDescriptorResponse };
  "BluetoothEmulation.addService": { params: BluetoothEmulation.AddServiceRequest; result: BluetoothEmulation.AddServiceResponse };
  "BluetoothEmulation.disable": { params: BluetoothEmulation.DisableRequest; result: BluetoothEmulation.DisableResponse };
  "BluetoothEmulation.enable": { params: BluetoothEmulation.EnableRequest; result: BluetoothEmulation.EnableResponse };
  "BluetoothEmulation.removeCharacteristic": { params: BluetoothEmulation.RemoveCharacteristicRequest; result: BluetoothEmulation.RemoveCharacteristicResponse };
  "BluetoothEmulation.removeDescriptor": { params: BluetoothEmulation.RemoveDescriptorRequest; result: BluetoothEmulation.RemoveDescriptorResponse };
  "BluetoothEmulation.removeService": { params: BluetoothEmulation.RemoveServiceRequest; result: BluetoothEmulation.RemoveServiceResponse };
  "BluetoothEmulation.setSimulatedCentralState": { params: BluetoothEmulation.SetSimulatedCentralStateRequest; result: BluetoothEmulation.SetSimulatedCentralStateResponse };
  "BluetoothEmulation.simulateAdvertisement": { params: BluetoothEmulation.SimulateAdvertisementRequest; result: BluetoothEmulation.SimulateAdvertisementResponse };
  "BluetoothEmulation.simulateCharacteristicOperationResponse": { params: BluetoothEmulation.SimulateCharacteristicOperationResponseRequest; result: BluetoothEmulation.SimulateCharacteristicOperationResponseResponse };
  "BluetoothEmulation.simulateDescriptorOperationResponse": { params: BluetoothEmulation.SimulateDescriptorOperationResponseRequest; result: BluetoothEmulation.SimulateDescriptorOperationResponseResponse };
  "BluetoothEmulation.simulateGATTDisconnection": { params: BluetoothEmulation.SimulateGATTDisconnectionRequest; result: BluetoothEmulation.SimulateGATTDisconnectionResponse };
  "BluetoothEmulation.simulateGATTOperationResponse": { params: BluetoothEmulation.SimulateGATTOperationResponseRequest; result: BluetoothEmulation.SimulateGATTOperationResponseResponse };
  "BluetoothEmulation.simulatePreconnectedPeripheral": { params: BluetoothEmulation.SimulatePreconnectedPeripheralRequest; result: BluetoothEmulation.SimulatePreconnectedPeripheralResponse };
  "Browser.addPrivacySandboxCoordinatorKeyConfig": { params: Browser.AddPrivacySandboxCoordinatorKeyConfigRequest; result: Browser.AddPrivacySandboxCoordinatorKeyConfigResponse };
  "Browser.addPrivacySandboxEnrollmentOverride": { params: Browser.AddPrivacySandboxEnrollmentOverrideRequest; result: Browser.AddPrivacySandboxEnrollmentOverrideResponse };
  "Browser.cancelDownload": { params: Browser.CancelDownloadRequest; result: Browser.CancelDownloadResponse };
  "Browser.close": { params: Browser.CloseRequest; result: Browser.CloseResponse };
  "Browser.crash": { params: Browser.CrashRequest; result: Browser.CrashResponse };
  "Browser.crashGpuProcess": { params: Browser.CrashGpuProcessRequest; result: Browser.CrashGpuProcessResponse };
  "Browser.executeBrowserCommand": { params: Browser.ExecuteBrowserCommandRequest; result: Browser.ExecuteBrowserCommandResponse };
  "Browser.getBrowserCommandLine": { params: Browser.GetBrowserCommandLineRequest; result: Browser.GetBrowserCommandLineResponse };
  "Browser.getHistogram": { params: Browser.GetHistogramRequest; result: Browser.GetHistogramResponse };
  "Browser.getHistograms": { params: Browser.GetHistogramsRequest; result: Browser.GetHistogramsResponse };
  "Browser.getVersion": { params: Browser.GetVersionRequest; result: Browser.GetVersionResponse };
  "Browser.getWindowBounds": { params: Browser.GetWindowBoundsRequest; result: Browser.GetWindowBoundsResponse };
  "Browser.getWindowForTarget": { params: Browser.GetWindowForTargetRequest; result: Browser.GetWindowForTargetResponse };
  "Browser.grantPermissions": { params: Browser.GrantPermissionsRequest; result: Browser.GrantPermissionsResponse };
  "Browser.resetPermissions": { params: Browser.ResetPermissionsRequest; result: Browser.ResetPermissionsResponse };
  "Browser.setContentsSize": { params: Browser.SetContentsSizeRequest; result: Browser.SetContentsSizeResponse };
  "Browser.setDockTile": { params: Browser.SetDockTileRequest; result: Browser.SetDockTileResponse };
  "Browser.setDownloadBehavior": { params: Browser.SetDownloadBehaviorRequest; result: Browser.SetDownloadBehaviorResponse };
  "Browser.setPermission": { params: Browser.SetPermissionRequest; result: Browser.SetPermissionResponse };
  "Browser.setWindowBounds": { params: Browser.SetWindowBoundsRequest; result: Browser.SetWindowBoundsResponse };
  "CacheStorage.deleteCache": { params: CacheStorage.DeleteCacheRequest; result: CacheStorage.DeleteCacheResponse };
  "CacheStorage.deleteEntry": { params: CacheStorage.DeleteEntryRequest; result: CacheStorage.DeleteEntryResponse };
  "CacheStorage.requestCachedResponse": { params: CacheStorage.RequestCachedResponseRequest; result: CacheStorage.RequestCachedResponseResponse };
  "CacheStorage.requestCacheNames": { params: CacheStorage.RequestCacheNamesRequest; result: CacheStorage.RequestCacheNamesResponse };
  "CacheStorage.requestEntries": { params: CacheStorage.RequestEntriesRequest; result: CacheStorage.RequestEntriesResponse };
  "Cast.disable": { params: Cast.DisableRequest; result: Cast.DisableResponse };
  "Cast.enable": { params: Cast.EnableRequest; result: Cast.EnableResponse };
  "Cast.setSinkToUse": { params: Cast.SetSinkToUseRequest; result: Cast.SetSinkToUseResponse };
  "Cast.startDesktopMirroring": { params: Cast.StartDesktopMirroringRequest; result: Cast.StartDesktopMirroringResponse };
  "Cast.startTabMirroring": { params: Cast.StartTabMirroringRequest; result: Cast.StartTabMirroringResponse };
  "Cast.stopCasting": { params: Cast.StopCastingRequest; result: Cast.StopCastingResponse };
  "Console.clearMessages": { params: Console.ClearMessagesRequest; result: Console.ClearMessagesResponse };
  "Console.disable": { params: Console.DisableRequest; result: Console.DisableResponse };
  "Console.enable": { params: Console.EnableRequest; result: Console.EnableResponse };
  "CrashReportContext.getEntries": { params: CrashReportContext.GetEntriesRequest; result: CrashReportContext.GetEntriesResponse };
  "CSS.addRule": { params: CSS.AddRuleRequest; result: CSS.AddRuleResponse };
  "CSS.collectClassNames": { params: CSS.CollectClassNamesRequest; result: CSS.CollectClassNamesResponse };
  "CSS.createStyleSheet": { params: CSS.CreateStyleSheetRequest; result: CSS.CreateStyleSheetResponse };
  "CSS.disable": { params: CSS.DisableRequest; result: CSS.DisableResponse };
  "CSS.enable": { params: CSS.EnableRequest; result: CSS.EnableResponse };
  "CSS.forcePseudoState": { params: CSS.ForcePseudoStateRequest; result: CSS.ForcePseudoStateResponse };
  "CSS.forceStartingStyle": { params: CSS.ForceStartingStyleRequest; result: CSS.ForceStartingStyleResponse };
  "CSS.getAnimatedStylesForNode": { params: CSS.GetAnimatedStylesForNodeRequest; result: CSS.GetAnimatedStylesForNodeResponse };
  "CSS.getBackgroundColors": { params: CSS.GetBackgroundColorsRequest; result: CSS.GetBackgroundColorsResponse };
  "CSS.getComputedStyleForNode": { params: CSS.GetComputedStyleForNodeRequest; result: CSS.GetComputedStyleForNodeResponse };
  "CSS.getEnvironmentVariables": { params: CSS.GetEnvironmentVariablesRequest; result: CSS.GetEnvironmentVariablesResponse };
  "CSS.getInlineStylesForNode": { params: CSS.GetInlineStylesForNodeRequest; result: CSS.GetInlineStylesForNodeResponse };
  "CSS.getLayersForNode": { params: CSS.GetLayersForNodeRequest; result: CSS.GetLayersForNodeResponse };
  "CSS.getLocationForSelector": { params: CSS.GetLocationForSelectorRequest; result: CSS.GetLocationForSelectorResponse };
  "CSS.getLonghandProperties": { params: CSS.GetLonghandPropertiesRequest; result: CSS.GetLonghandPropertiesResponse };
  "CSS.getMatchedStylesForNode": { params: CSS.GetMatchedStylesForNodeRequest; result: CSS.GetMatchedStylesForNodeResponse };
  "CSS.getMediaQueries": { params: CSS.GetMediaQueriesRequest; result: CSS.GetMediaQueriesResponse };
  "CSS.getPlatformFontsForNode": { params: CSS.GetPlatformFontsForNodeRequest; result: CSS.GetPlatformFontsForNodeResponse };
  "CSS.getStyleSheetText": { params: CSS.GetStyleSheetTextRequest; result: CSS.GetStyleSheetTextResponse };
  "CSS.resolveValues": { params: CSS.ResolveValuesRequest; result: CSS.ResolveValuesResponse };
  "CSS.setContainerQueryText": { params: CSS.SetContainerQueryTextRequest; result: CSS.SetContainerQueryTextResponse };
  "CSS.setEffectivePropertyValueForNode": { params: CSS.SetEffectivePropertyValueForNodeRequest; result: CSS.SetEffectivePropertyValueForNodeResponse };
  "CSS.setKeyframeKey": { params: CSS.SetKeyframeKeyRequest; result: CSS.SetKeyframeKeyResponse };
  "CSS.setLocalFontsEnabled": { params: CSS.SetLocalFontsEnabledRequest; result: CSS.SetLocalFontsEnabledResponse };
  "CSS.setMediaText": { params: CSS.SetMediaTextRequest; result: CSS.SetMediaTextResponse };
  "CSS.setNavigationText": { params: CSS.SetNavigationTextRequest; result: CSS.SetNavigationTextResponse };
  "CSS.setPropertyRulePropertyName": { params: CSS.SetPropertyRulePropertyNameRequest; result: CSS.SetPropertyRulePropertyNameResponse };
  "CSS.setRuleSelector": { params: CSS.SetRuleSelectorRequest; result: CSS.SetRuleSelectorResponse };
  "CSS.setScopeText": { params: CSS.SetScopeTextRequest; result: CSS.SetScopeTextResponse };
  "CSS.setStyleSheetText": { params: CSS.SetStyleSheetTextRequest; result: CSS.SetStyleSheetTextResponse };
  "CSS.setStyleTexts": { params: CSS.SetStyleTextsRequest; result: CSS.SetStyleTextsResponse };
  "CSS.setSupportsText": { params: CSS.SetSupportsTextRequest; result: CSS.SetSupportsTextResponse };
  "CSS.startRuleUsageTracking": { params: CSS.StartRuleUsageTrackingRequest; result: CSS.StartRuleUsageTrackingResponse };
  "CSS.stopRuleUsageTracking": { params: CSS.StopRuleUsageTrackingRequest; result: CSS.StopRuleUsageTrackingResponse };
  "CSS.takeComputedStyleUpdates": { params: CSS.TakeComputedStyleUpdatesRequest; result: CSS.TakeComputedStyleUpdatesResponse };
  "CSS.takeCoverageDelta": { params: CSS.TakeCoverageDeltaRequest; result: CSS.TakeCoverageDeltaResponse };
  "CSS.trackComputedStyleUpdates": { params: CSS.TrackComputedStyleUpdatesRequest; result: CSS.TrackComputedStyleUpdatesResponse };
  "CSS.trackComputedStyleUpdatesForNode": { params: CSS.TrackComputedStyleUpdatesForNodeRequest; result: CSS.TrackComputedStyleUpdatesForNodeResponse };
  "Debugger.continueToLocation": { params: Debugger.ContinueToLocationRequest; result: Debugger.ContinueToLocationResponse };
  "Debugger.disable": { params: Debugger.DisableRequest; result: Debugger.DisableResponse };
  "Debugger.disassembleWasmModule": { params: Debugger.DisassembleWasmModuleRequest; result: Debugger.DisassembleWasmModuleResponse };
  "Debugger.enable": { params: Debugger.EnableRequest; result: Debugger.EnableResponse };
  "Debugger.evaluateOnCallFrame": { params: Debugger.EvaluateOnCallFrameRequest; result: Debugger.EvaluateOnCallFrameResponse };
  "Debugger.getPossibleBreakpoints": { params: Debugger.GetPossibleBreakpointsRequest; result: Debugger.GetPossibleBreakpointsResponse };
  "Debugger.getScriptSource": { params: Debugger.GetScriptSourceRequest; result: Debugger.GetScriptSourceResponse };
  "Debugger.getStackTrace": { params: Debugger.GetStackTraceRequest; result: Debugger.GetStackTraceResponse };
  "Debugger.getWasmBytecode": { params: Debugger.GetWasmBytecodeRequest; result: Debugger.GetWasmBytecodeResponse };
  "Debugger.nextWasmDisassemblyChunk": { params: Debugger.NextWasmDisassemblyChunkRequest; result: Debugger.NextWasmDisassemblyChunkResponse };
  "Debugger.pause": { params: Debugger.PauseRequest; result: Debugger.PauseResponse };
  "Debugger.pauseOnAsyncCall": { params: Debugger.PauseOnAsyncCallRequest; result: Debugger.PauseOnAsyncCallResponse };
  "Debugger.removeBreakpoint": { params: Debugger.RemoveBreakpointRequest; result: Debugger.RemoveBreakpointResponse };
  "Debugger.restartFrame": { params: Debugger.RestartFrameRequest; result: Debugger.RestartFrameResponse };
  "Debugger.resume": { params: Debugger.ResumeRequest; result: Debugger.ResumeResponse };
  "Debugger.searchInContent": { params: Debugger.SearchInContentRequest; result: Debugger.SearchInContentResponse };
  "Debugger.setAsyncCallStackDepth": { params: Debugger.SetAsyncCallStackDepthRequest; result: Debugger.SetAsyncCallStackDepthResponse };
  "Debugger.setBlackboxedRanges": { params: Debugger.SetBlackboxedRangesRequest; result: Debugger.SetBlackboxedRangesResponse };
  "Debugger.setBlackboxExecutionContexts": { params: Debugger.SetBlackboxExecutionContextsRequest; result: Debugger.SetBlackboxExecutionContextsResponse };
  "Debugger.setBlackboxPatterns": { params: Debugger.SetBlackboxPatternsRequest; result: Debugger.SetBlackboxPatternsResponse };
  "Debugger.setBreakpoint": { params: Debugger.SetBreakpointRequest; result: Debugger.SetBreakpointResponse };
  "Debugger.setBreakpointByUrl": { params: Debugger.SetBreakpointByUrlRequest; result: Debugger.SetBreakpointByUrlResponse };
  "Debugger.setBreakpointOnFunctionCall": { params: Debugger.SetBreakpointOnFunctionCallRequest; result: Debugger.SetBreakpointOnFunctionCallResponse };
  "Debugger.setBreakpointsActive": { params: Debugger.SetBreakpointsActiveRequest; result: Debugger.SetBreakpointsActiveResponse };
  "Debugger.setInstrumentationBreakpoint": { params: Debugger.SetInstrumentationBreakpointRequest; result: Debugger.SetInstrumentationBreakpointResponse };
  "Debugger.setPauseOnExceptions": { params: Debugger.SetPauseOnExceptionsRequest; result: Debugger.SetPauseOnExceptionsResponse };
  "Debugger.setReturnValue": { params: Debugger.SetReturnValueRequest; result: Debugger.SetReturnValueResponse };
  "Debugger.setScriptSource": { params: Debugger.SetScriptSourceRequest; result: Debugger.SetScriptSourceResponse };
  "Debugger.setSkipAllPauses": { params: Debugger.SetSkipAllPausesRequest; result: Debugger.SetSkipAllPausesResponse };
  "Debugger.setVariableValue": { params: Debugger.SetVariableValueRequest; result: Debugger.SetVariableValueResponse };
  "Debugger.stepInto": { params: Debugger.StepIntoRequest; result: Debugger.StepIntoResponse };
  "Debugger.stepOut": { params: Debugger.StepOutRequest; result: Debugger.StepOutResponse };
  "Debugger.stepOver": { params: Debugger.StepOverRequest; result: Debugger.StepOverResponse };
  "DeviceAccess.cancelPrompt": { params: DeviceAccess.CancelPromptRequest; result: DeviceAccess.CancelPromptResponse };
  "DeviceAccess.disable": { params: DeviceAccess.DisableRequest; result: DeviceAccess.DisableResponse };
  "DeviceAccess.enable": { params: DeviceAccess.EnableRequest; result: DeviceAccess.EnableResponse };
  "DeviceAccess.selectPrompt": { params: DeviceAccess.SelectPromptRequest; result: DeviceAccess.SelectPromptResponse };
  "DeviceOrientation.clearDeviceOrientationOverride": { params: DeviceOrientation.ClearDeviceOrientationOverrideRequest; result: DeviceOrientation.ClearDeviceOrientationOverrideResponse };
  "DeviceOrientation.setDeviceOrientationOverride": { params: DeviceOrientation.SetDeviceOrientationOverrideRequest; result: DeviceOrientation.SetDeviceOrientationOverrideResponse };
  "DOM.collectClassNamesFromSubtree": { params: DOM.CollectClassNamesFromSubtreeRequest; result: DOM.CollectClassNamesFromSubtreeResponse };
  "DOM.copyTo": { params: DOM.CopyToRequest; result: DOM.CopyToResponse };
  "DOM.describeNode": { params: DOM.DescribeNodeRequest; result: DOM.DescribeNodeResponse };
  "DOM.disable": { params: DOM.DisableRequest; result: DOM.DisableResponse };
  "DOM.discardSearchResults": { params: DOM.DiscardSearchResultsRequest; result: DOM.DiscardSearchResultsResponse };
  "DOM.enable": { params: DOM.EnableRequest; result: DOM.EnableResponse };
  "DOM.focus": { params: DOM.FocusRequest; result: DOM.FocusResponse };
  "DOM.forceShowPopover": { params: DOM.ForceShowPopoverRequest; result: DOM.ForceShowPopoverResponse };
  "DOM.getAnchorElement": { params: DOM.GetAnchorElementRequest; result: DOM.GetAnchorElementResponse };
  "DOM.getAttributes": { params: DOM.GetAttributesRequest; result: DOM.GetAttributesResponse };
  "DOM.getBoxModel": { params: DOM.GetBoxModelRequest; result: DOM.GetBoxModelResponse };
  "DOM.getContainerForNode": { params: DOM.GetContainerForNodeRequest; result: DOM.GetContainerForNodeResponse };
  "DOM.getContentQuads": { params: DOM.GetContentQuadsRequest; result: DOM.GetContentQuadsResponse };
  "DOM.getDetachedDomNodes": { params: DOM.GetDetachedDomNodesRequest; result: DOM.GetDetachedDomNodesResponse };
  "DOM.getDocument": { params: DOM.GetDocumentRequest; result: DOM.GetDocumentResponse };
  "DOM.getElementByRelation": { params: DOM.GetElementByRelationRequest; result: DOM.GetElementByRelationResponse };
  "DOM.getFileInfo": { params: DOM.GetFileInfoRequest; result: DOM.GetFileInfoResponse };
  "DOM.getFlattenedDocument": { params: DOM.GetFlattenedDocumentRequest; result: DOM.GetFlattenedDocumentResponse };
  "DOM.getFrameOwner": { params: DOM.GetFrameOwnerRequest; result: DOM.GetFrameOwnerResponse };
  "DOM.getNodeForLocation": { params: DOM.GetNodeForLocationRequest; result: DOM.GetNodeForLocationResponse };
  "DOM.getNodesForSubtreeByStyle": { params: DOM.GetNodesForSubtreeByStyleRequest; result: DOM.GetNodesForSubtreeByStyleResponse };
  "DOM.getNodeStackTraces": { params: DOM.GetNodeStackTracesRequest; result: DOM.GetNodeStackTracesResponse };
  "DOM.getOuterHTML": { params: DOM.GetOuterHTMLRequest; result: DOM.GetOuterHTMLResponse };
  "DOM.getQueryingDescendantsForContainer": { params: DOM.GetQueryingDescendantsForContainerRequest; result: DOM.GetQueryingDescendantsForContainerResponse };
  "DOM.getRelayoutBoundary": { params: DOM.GetRelayoutBoundaryRequest; result: DOM.GetRelayoutBoundaryResponse };
  "DOM.getSearchResults": { params: DOM.GetSearchResultsRequest; result: DOM.GetSearchResultsResponse };
  "DOM.getTopLayerElements": { params: DOM.GetTopLayerElementsRequest; result: DOM.GetTopLayerElementsResponse };
  "DOM.markUndoableState": { params: DOM.MarkUndoableStateRequest; result: DOM.MarkUndoableStateResponse };
  "DOM.moveTo": { params: DOM.MoveToRequest; result: DOM.MoveToResponse };
  "DOM.performSearch": { params: DOM.PerformSearchRequest; result: DOM.PerformSearchResponse };
  "DOM.pushNodeByPathToFrontend": { params: DOM.PushNodeByPathToFrontendRequest; result: DOM.PushNodeByPathToFrontendResponse };
  "DOM.pushNodesByBackendIdsToFrontend": { params: DOM.PushNodesByBackendIdsToFrontendRequest; result: DOM.PushNodesByBackendIdsToFrontendResponse };
  "DOM.querySelector": { params: DOM.QuerySelectorRequest; result: DOM.QuerySelectorResponse };
  "DOM.querySelectorAll": { params: DOM.QuerySelectorAllRequest; result: DOM.QuerySelectorAllResponse };
  "DOM.redo": { params: DOM.RedoRequest; result: DOM.RedoResponse };
  "DOM.removeAttribute": { params: DOM.RemoveAttributeRequest; result: DOM.RemoveAttributeResponse };
  "DOM.removeNode": { params: DOM.RemoveNodeRequest; result: DOM.RemoveNodeResponse };
  "DOM.requestChildNodes": { params: DOM.RequestChildNodesRequest; result: DOM.RequestChildNodesResponse };
  "DOM.requestNode": { params: DOM.RequestNodeRequest; result: DOM.RequestNodeResponse };
  "DOM.resolveNode": { params: DOM.ResolveNodeRequest; result: DOM.ResolveNodeResponse };
  "DOM.scrollIntoViewIfNeeded": { params: DOM.ScrollIntoViewIfNeededRequest; result: DOM.ScrollIntoViewIfNeededResponse };
  "DOM.setAttributesAsText": { params: DOM.SetAttributesAsTextRequest; result: DOM.SetAttributesAsTextResponse };
  "DOM.setAttributeValue": { params: DOM.SetAttributeValueRequest; result: DOM.SetAttributeValueResponse };
  "DOM.setFileInputFiles": { params: DOM.SetFileInputFilesRequest; result: DOM.SetFileInputFilesResponse };
  "DOM.setInspectedNode": { params: DOM.SetInspectedNodeRequest; result: DOM.SetInspectedNodeResponse };
  "DOM.setNodeName": { params: DOM.SetNodeNameRequest; result: DOM.SetNodeNameResponse };
  "DOM.setNodeStackTracesEnabled": { params: DOM.SetNodeStackTracesEnabledRequest; result: DOM.SetNodeStackTracesEnabledResponse };
  "DOM.setNodeValue": { params: DOM.SetNodeValueRequest; result: DOM.SetNodeValueResponse };
  "DOM.setOuterHTML": { params: DOM.SetOuterHTMLRequest; result: DOM.SetOuterHTMLResponse };
  "DOM.undo": { params: DOM.UndoRequest; result: DOM.UndoResponse };
  "DOMDebugger.getEventListeners": { params: DOMDebugger.GetEventListenersRequest; result: DOMDebugger.GetEventListenersResponse };
  "DOMDebugger.removeDOMBreakpoint": { params: DOMDebugger.RemoveDOMBreakpointRequest; result: DOMDebugger.RemoveDOMBreakpointResponse };
  "DOMDebugger.removeEventListenerBreakpoint": { params: DOMDebugger.RemoveEventListenerBreakpointRequest; result: DOMDebugger.RemoveEventListenerBreakpointResponse };
  "DOMDebugger.removeXHRBreakpoint": { params: DOMDebugger.RemoveXHRBreakpointRequest; result: DOMDebugger.RemoveXHRBreakpointResponse };
  "DOMDebugger.setBreakOnCSPViolation": { params: DOMDebugger.SetBreakOnCSPViolationRequest; result: DOMDebugger.SetBreakOnCSPViolationResponse };
  "DOMDebugger.setDOMBreakpoint": { params: DOMDebugger.SetDOMBreakpointRequest; result: DOMDebugger.SetDOMBreakpointResponse };
  "DOMDebugger.setEventListenerBreakpoint": { params: DOMDebugger.SetEventListenerBreakpointRequest; result: DOMDebugger.SetEventListenerBreakpointResponse };
  "DOMDebugger.setXHRBreakpoint": { params: DOMDebugger.SetXHRBreakpointRequest; result: DOMDebugger.SetXHRBreakpointResponse };
  "DOMSnapshot.captureSnapshot": { params: DOMSnapshot.CaptureSnapshotRequest; result: DOMSnapshot.CaptureSnapshotResponse };
  "DOMSnapshot.disable": { params: DOMSnapshot.DisableRequest; result: DOMSnapshot.DisableResponse };
  "DOMSnapshot.enable": { params: DOMSnapshot.EnableRequest; result: DOMSnapshot.EnableResponse };
  "DOMSnapshot.getSnapshot": { params: DOMSnapshot.GetSnapshotRequest; result: DOMSnapshot.GetSnapshotResponse };
  "DOMStorage.clear": { params: DOMStorage.ClearRequest; result: DOMStorage.ClearResponse };
  "DOMStorage.disable": { params: DOMStorage.DisableRequest; result: DOMStorage.DisableResponse };
  "DOMStorage.enable": { params: DOMStorage.EnableRequest; result: DOMStorage.EnableResponse };
  "DOMStorage.getDOMStorageItems": { params: DOMStorage.GetDOMStorageItemsRequest; result: DOMStorage.GetDOMStorageItemsResponse };
  "DOMStorage.removeDOMStorageItem": { params: DOMStorage.RemoveDOMStorageItemRequest; result: DOMStorage.RemoveDOMStorageItemResponse };
  "DOMStorage.setDOMStorageItem": { params: DOMStorage.SetDOMStorageItemRequest; result: DOMStorage.SetDOMStorageItemResponse };
  "Emulation.addScreen": { params: Emulation.AddScreenRequest; result: Emulation.AddScreenResponse };
  "Emulation.canEmulate": { params: Emulation.CanEmulateRequest; result: Emulation.CanEmulateResponse };
  "Emulation.clearDeviceMetricsOverride": { params: Emulation.ClearDeviceMetricsOverrideRequest; result: Emulation.ClearDeviceMetricsOverrideResponse };
  "Emulation.clearDevicePostureOverride": { params: Emulation.ClearDevicePostureOverrideRequest; result: Emulation.ClearDevicePostureOverrideResponse };
  "Emulation.clearDisplayFeaturesOverride": { params: Emulation.ClearDisplayFeaturesOverrideRequest; result: Emulation.ClearDisplayFeaturesOverrideResponse };
  "Emulation.clearGeolocationOverride": { params: Emulation.ClearGeolocationOverrideRequest; result: Emulation.ClearGeolocationOverrideResponse };
  "Emulation.clearIdleOverride": { params: Emulation.ClearIdleOverrideRequest; result: Emulation.ClearIdleOverrideResponse };
  "Emulation.getOverriddenSensorInformation": { params: Emulation.GetOverriddenSensorInformationRequest; result: Emulation.GetOverriddenSensorInformationResponse };
  "Emulation.getScreenInfos": { params: Emulation.GetScreenInfosRequest; result: Emulation.GetScreenInfosResponse };
  "Emulation.removeScreen": { params: Emulation.RemoveScreenRequest; result: Emulation.RemoveScreenResponse };
  "Emulation.resetPageScaleFactor": { params: Emulation.ResetPageScaleFactorRequest; result: Emulation.ResetPageScaleFactorResponse };
  "Emulation.setAutoDarkModeOverride": { params: Emulation.SetAutoDarkModeOverrideRequest; result: Emulation.SetAutoDarkModeOverrideResponse };
  "Emulation.setAutomationOverride": { params: Emulation.SetAutomationOverrideRequest; result: Emulation.SetAutomationOverrideResponse };
  "Emulation.setCPUThrottlingRate": { params: Emulation.SetCPUThrottlingRateRequest; result: Emulation.SetCPUThrottlingRateResponse };
  "Emulation.setDataSaverOverride": { params: Emulation.SetDataSaverOverrideRequest; result: Emulation.SetDataSaverOverrideResponse };
  "Emulation.setDefaultBackgroundColorOverride": { params: Emulation.SetDefaultBackgroundColorOverrideRequest; result: Emulation.SetDefaultBackgroundColorOverrideResponse };
  "Emulation.setDeviceMetricsOverride": { params: Emulation.SetDeviceMetricsOverrideRequest; result: Emulation.SetDeviceMetricsOverrideResponse };
  "Emulation.setDevicePostureOverride": { params: Emulation.SetDevicePostureOverrideRequest; result: Emulation.SetDevicePostureOverrideResponse };
  "Emulation.setDisabledImageTypes": { params: Emulation.SetDisabledImageTypesRequest; result: Emulation.SetDisabledImageTypesResponse };
  "Emulation.setDisplayFeaturesOverride": { params: Emulation.SetDisplayFeaturesOverrideRequest; result: Emulation.SetDisplayFeaturesOverrideResponse };
  "Emulation.setDocumentCookieDisabled": { params: Emulation.SetDocumentCookieDisabledRequest; result: Emulation.SetDocumentCookieDisabledResponse };
  "Emulation.setEmitTouchEventsForMouse": { params: Emulation.SetEmitTouchEventsForMouseRequest; result: Emulation.SetEmitTouchEventsForMouseResponse };
  "Emulation.setEmulatedMedia": { params: Emulation.SetEmulatedMediaRequest; result: Emulation.SetEmulatedMediaResponse };
  "Emulation.setEmulatedOSTextScale": { params: Emulation.SetEmulatedOSTextScaleRequest; result: Emulation.SetEmulatedOSTextScaleResponse };
  "Emulation.setEmulatedVisionDeficiency": { params: Emulation.SetEmulatedVisionDeficiencyRequest; result: Emulation.SetEmulatedVisionDeficiencyResponse };
  "Emulation.setFocusEmulationEnabled": { params: Emulation.SetFocusEmulationEnabledRequest; result: Emulation.SetFocusEmulationEnabledResponse };
  "Emulation.setGeolocationOverride": { params: Emulation.SetGeolocationOverrideRequest; result: Emulation.SetGeolocationOverrideResponse };
  "Emulation.setHardwareConcurrencyOverride": { params: Emulation.SetHardwareConcurrencyOverrideRequest; result: Emulation.SetHardwareConcurrencyOverrideResponse };
  "Emulation.setIdleOverride": { params: Emulation.SetIdleOverrideRequest; result: Emulation.SetIdleOverrideResponse };
  "Emulation.setLocaleOverride": { params: Emulation.SetLocaleOverrideRequest; result: Emulation.SetLocaleOverrideResponse };
  "Emulation.setNavigatorOverrides": { params: Emulation.SetNavigatorOverridesRequest; result: Emulation.SetNavigatorOverridesResponse };
  "Emulation.setPageScaleFactor": { params: Emulation.SetPageScaleFactorRequest; result: Emulation.SetPageScaleFactorResponse };
  "Emulation.setPressureDataOverride": { params: Emulation.SetPressureDataOverrideRequest; result: Emulation.SetPressureDataOverrideResponse };
  "Emulation.setPressureSourceOverrideEnabled": { params: Emulation.SetPressureSourceOverrideEnabledRequest; result: Emulation.SetPressureSourceOverrideEnabledResponse };
  "Emulation.setPressureStateOverride": { params: Emulation.SetPressureStateOverrideRequest; result: Emulation.SetPressureStateOverrideResponse };
  "Emulation.setPrimaryScreen": { params: Emulation.SetPrimaryScreenRequest; result: Emulation.SetPrimaryScreenResponse };
  "Emulation.setSafeAreaInsetsOverride": { params: Emulation.SetSafeAreaInsetsOverrideRequest; result: Emulation.SetSafeAreaInsetsOverrideResponse };
  "Emulation.setScriptExecutionDisabled": { params: Emulation.SetScriptExecutionDisabledRequest; result: Emulation.SetScriptExecutionDisabledResponse };
  "Emulation.setScrollbarsHidden": { params: Emulation.SetScrollbarsHiddenRequest; result: Emulation.SetScrollbarsHiddenResponse };
  "Emulation.setSensorOverrideEnabled": { params: Emulation.SetSensorOverrideEnabledRequest; result: Emulation.SetSensorOverrideEnabledResponse };
  "Emulation.setSensorOverrideReadings": { params: Emulation.SetSensorOverrideReadingsRequest; result: Emulation.SetSensorOverrideReadingsResponse };
  "Emulation.setSmallViewportHeightDifferenceOverride": { params: Emulation.SetSmallViewportHeightDifferenceOverrideRequest; result: Emulation.SetSmallViewportHeightDifferenceOverrideResponse };
  "Emulation.setTimezoneOverride": { params: Emulation.SetTimezoneOverrideRequest; result: Emulation.SetTimezoneOverrideResponse };
  "Emulation.setTouchEmulationEnabled": { params: Emulation.SetTouchEmulationEnabledRequest; result: Emulation.SetTouchEmulationEnabledResponse };
  "Emulation.setUserAgentOverride": { params: Emulation.SetUserAgentOverrideRequest; result: Emulation.SetUserAgentOverrideResponse };
  "Emulation.setVirtualTimePolicy": { params: Emulation.SetVirtualTimePolicyRequest; result: Emulation.SetVirtualTimePolicyResponse };
  "Emulation.setVisibleSize": { params: Emulation.SetVisibleSizeRequest; result: Emulation.SetVisibleSizeResponse };
  "Emulation.updateScreen": { params: Emulation.UpdateScreenRequest; result: Emulation.UpdateScreenResponse };
  "EventBreakpoints.disable": { params: EventBreakpoints.DisableRequest; result: EventBreakpoints.DisableResponse };
  "EventBreakpoints.removeInstrumentationBreakpoint": { params: EventBreakpoints.RemoveInstrumentationBreakpointRequest; result: EventBreakpoints.RemoveInstrumentationBreakpointResponse };
  "EventBreakpoints.setInstrumentationBreakpoint": { params: EventBreakpoints.SetInstrumentationBreakpointRequest; result: EventBreakpoints.SetInstrumentationBreakpointResponse };
  "Extensions.clearStorageItems": { params: Extensions.ClearStorageItemsRequest; result: Extensions.ClearStorageItemsResponse };
  "Extensions.getExtensions": { params: Extensions.GetExtensionsRequest; result: Extensions.GetExtensionsResponse };
  "Extensions.getStorageItems": { params: Extensions.GetStorageItemsRequest; result: Extensions.GetStorageItemsResponse };
  "Extensions.loadUnpacked": { params: Extensions.LoadUnpackedRequest; result: Extensions.LoadUnpackedResponse };
  "Extensions.removeStorageItems": { params: Extensions.RemoveStorageItemsRequest; result: Extensions.RemoveStorageItemsResponse };
  "Extensions.setStorageItems": { params: Extensions.SetStorageItemsRequest; result: Extensions.SetStorageItemsResponse };
  "Extensions.triggerAction": { params: Extensions.TriggerActionRequest; result: Extensions.TriggerActionResponse };
  "Extensions.uninstall": { params: Extensions.UninstallRequest; result: Extensions.UninstallResponse };
  "FedCm.clickDialogButton": { params: FedCm.ClickDialogButtonRequest; result: FedCm.ClickDialogButtonResponse };
  "FedCm.disable": { params: FedCm.DisableRequest; result: FedCm.DisableResponse };
  "FedCm.dismissDialog": { params: FedCm.DismissDialogRequest; result: FedCm.DismissDialogResponse };
  "FedCm.enable": { params: FedCm.EnableRequest; result: FedCm.EnableResponse };
  "FedCm.openUrl": { params: FedCm.OpenUrlRequest; result: FedCm.OpenUrlResponse };
  "FedCm.resetCooldown": { params: FedCm.ResetCooldownRequest; result: FedCm.ResetCooldownResponse };
  "FedCm.selectAccount": { params: FedCm.SelectAccountRequest; result: FedCm.SelectAccountResponse };
  "Fetch.continueRequest": { params: Fetch.ContinueRequestRequest; result: Fetch.ContinueRequestResponse };
  "Fetch.continueResponse": { params: Fetch.ContinueResponseRequest; result: Fetch.ContinueResponseResponse };
  "Fetch.continueWithAuth": { params: Fetch.ContinueWithAuthRequest; result: Fetch.ContinueWithAuthResponse };
  "Fetch.disable": { params: Fetch.DisableRequest; result: Fetch.DisableResponse };
  "Fetch.enable": { params: Fetch.EnableRequest; result: Fetch.EnableResponse };
  "Fetch.failRequest": { params: Fetch.FailRequestRequest; result: Fetch.FailRequestResponse };
  "Fetch.fulfillRequest": { params: Fetch.FulfillRequestRequest; result: Fetch.FulfillRequestResponse };
  "Fetch.getResponseBody": { params: Fetch.GetResponseBodyRequest; result: Fetch.GetResponseBodyResponse };
  "Fetch.takeResponseBodyAsStream": { params: Fetch.TakeResponseBodyAsStreamRequest; result: Fetch.TakeResponseBodyAsStreamResponse };
  "FileSystem.getDirectory": { params: FileSystem.GetDirectoryRequest; result: FileSystem.GetDirectoryResponse };
  "HeadlessExperimental.beginFrame": { params: HeadlessExperimental.BeginFrameRequest; result: HeadlessExperimental.BeginFrameResponse };
  "HeadlessExperimental.disable": { params: HeadlessExperimental.DisableRequest; result: HeadlessExperimental.DisableResponse };
  "HeadlessExperimental.enable": { params: HeadlessExperimental.EnableRequest; result: HeadlessExperimental.EnableResponse };
  "HeapProfiler.addInspectedHeapObject": { params: HeapProfiler.AddInspectedHeapObjectRequest; result: HeapProfiler.AddInspectedHeapObjectResponse };
  "HeapProfiler.collectGarbage": { params: HeapProfiler.CollectGarbageRequest; result: HeapProfiler.CollectGarbageResponse };
  "HeapProfiler.disable": { params: HeapProfiler.DisableRequest; result: HeapProfiler.DisableResponse };
  "HeapProfiler.enable": { params: HeapProfiler.EnableRequest; result: HeapProfiler.EnableResponse };
  "HeapProfiler.getHeapObjectId": { params: HeapProfiler.GetHeapObjectIdRequest; result: HeapProfiler.GetHeapObjectIdResponse };
  "HeapProfiler.getObjectByHeapObjectId": { params: HeapProfiler.GetObjectByHeapObjectIdRequest; result: HeapProfiler.GetObjectByHeapObjectIdResponse };
  "HeapProfiler.getSamplingProfile": { params: HeapProfiler.GetSamplingProfileRequest; result: HeapProfiler.GetSamplingProfileResponse };
  "HeapProfiler.startSampling": { params: HeapProfiler.StartSamplingRequest; result: HeapProfiler.StartSamplingResponse };
  "HeapProfiler.startTrackingHeapObjects": { params: HeapProfiler.StartTrackingHeapObjectsRequest; result: HeapProfiler.StartTrackingHeapObjectsResponse };
  "HeapProfiler.stopSampling": { params: HeapProfiler.StopSamplingRequest; result: HeapProfiler.StopSamplingResponse };
  "HeapProfiler.stopTrackingHeapObjects": { params: HeapProfiler.StopTrackingHeapObjectsRequest; result: HeapProfiler.StopTrackingHeapObjectsResponse };
  "HeapProfiler.takeHeapSnapshot": { params: HeapProfiler.TakeHeapSnapshotRequest; result: HeapProfiler.TakeHeapSnapshotResponse };
  "IndexedDB.clearObjectStore": { params: IndexedDB.ClearObjectStoreRequest; result: IndexedDB.ClearObjectStoreResponse };
  "IndexedDB.deleteDatabase": { params: IndexedDB.DeleteDatabaseRequest; result: IndexedDB.DeleteDatabaseResponse };
  "IndexedDB.deleteObjectStoreEntries": { params: IndexedDB.DeleteObjectStoreEntriesRequest; result: IndexedDB.DeleteObjectStoreEntriesResponse };
  "IndexedDB.disable": { params: IndexedDB.DisableRequest; result: IndexedDB.DisableResponse };
  "IndexedDB.enable": { params: IndexedDB.EnableRequest; result: IndexedDB.EnableResponse };
  "IndexedDB.getMetadata": { params: IndexedDB.GetMetadataRequest; result: IndexedDB.GetMetadataResponse };
  "IndexedDB.requestData": { params: IndexedDB.RequestDataRequest; result: IndexedDB.RequestDataResponse };
  "IndexedDB.requestDatabase": { params: IndexedDB.RequestDatabaseRequest; result: IndexedDB.RequestDatabaseResponse };
  "IndexedDB.requestDatabaseNames": { params: IndexedDB.RequestDatabaseNamesRequest; result: IndexedDB.RequestDatabaseNamesResponse };
  "Input.cancelDragging": { params: Input.CancelDraggingRequest; result: Input.CancelDraggingResponse };
  "Input.dispatchDragEvent": { params: Input.DispatchDragEventRequest; result: Input.DispatchDragEventResponse };
  "Input.dispatchKeyEvent": { params: Input.DispatchKeyEventRequest; result: Input.DispatchKeyEventResponse };
  "Input.dispatchMouseEvent": { params: Input.DispatchMouseEventRequest; result: Input.DispatchMouseEventResponse };
  "Input.dispatchTouchEvent": { params: Input.DispatchTouchEventRequest; result: Input.DispatchTouchEventResponse };
  "Input.emulateTouchFromMouseEvent": { params: Input.EmulateTouchFromMouseEventRequest; result: Input.EmulateTouchFromMouseEventResponse };
  "Input.imeSetComposition": { params: Input.ImeSetCompositionRequest; result: Input.ImeSetCompositionResponse };
  "Input.insertText": { params: Input.InsertTextRequest; result: Input.InsertTextResponse };
  "Input.setIgnoreInputEvents": { params: Input.SetIgnoreInputEventsRequest; result: Input.SetIgnoreInputEventsResponse };
  "Input.setInterceptDrags": { params: Input.SetInterceptDragsRequest; result: Input.SetInterceptDragsResponse };
  "Input.synthesizePinchGesture": { params: Input.SynthesizePinchGestureRequest; result: Input.SynthesizePinchGestureResponse };
  "Input.synthesizeScrollGesture": { params: Input.SynthesizeScrollGestureRequest; result: Input.SynthesizeScrollGestureResponse };
  "Input.synthesizeTapGesture": { params: Input.SynthesizeTapGestureRequest; result: Input.SynthesizeTapGestureResponse };
  "Inspector.disable": { params: Inspector.DisableRequest; result: Inspector.DisableResponse };
  "Inspector.enable": { params: Inspector.EnableRequest; result: Inspector.EnableResponse };
  "IO.close": { params: IO.CloseRequest; result: IO.CloseResponse };
  "IO.read": { params: IO.ReadRequest; result: IO.ReadResponse };
  "IO.resolveBlob": { params: IO.ResolveBlobRequest; result: IO.ResolveBlobResponse };
  "LayerTree.compositingReasons": { params: LayerTree.CompositingReasonsRequest; result: LayerTree.CompositingReasonsResponse };
  "LayerTree.disable": { params: LayerTree.DisableRequest; result: LayerTree.DisableResponse };
  "LayerTree.enable": { params: LayerTree.EnableRequest; result: LayerTree.EnableResponse };
  "LayerTree.loadSnapshot": { params: LayerTree.LoadSnapshotRequest; result: LayerTree.LoadSnapshotResponse };
  "LayerTree.makeSnapshot": { params: LayerTree.MakeSnapshotRequest; result: LayerTree.MakeSnapshotResponse };
  "LayerTree.profileSnapshot": { params: LayerTree.ProfileSnapshotRequest; result: LayerTree.ProfileSnapshotResponse };
  "LayerTree.releaseSnapshot": { params: LayerTree.ReleaseSnapshotRequest; result: LayerTree.ReleaseSnapshotResponse };
  "LayerTree.replaySnapshot": { params: LayerTree.ReplaySnapshotRequest; result: LayerTree.ReplaySnapshotResponse };
  "LayerTree.snapshotCommandLog": { params: LayerTree.SnapshotCommandLogRequest; result: LayerTree.SnapshotCommandLogResponse };
  "Log.clear": { params: Log.ClearRequest; result: Log.ClearResponse };
  "Log.disable": { params: Log.DisableRequest; result: Log.DisableResponse };
  "Log.enable": { params: Log.EnableRequest; result: Log.EnableResponse };
  "Log.startViolationsReport": { params: Log.StartViolationsReportRequest; result: Log.StartViolationsReportResponse };
  "Log.stopViolationsReport": { params: Log.StopViolationsReportRequest; result: Log.StopViolationsReportResponse };
  "Media.disable": { params: Media.DisableRequest; result: Media.DisableResponse };
  "Media.enable": { params: Media.EnableRequest; result: Media.EnableResponse };
  "Memory.forciblyPurgeJavaScriptMemory": { params: Memory.ForciblyPurgeJavaScriptMemoryRequest; result: Memory.ForciblyPurgeJavaScriptMemoryResponse };
  "Memory.getAllTimeSamplingProfile": { params: Memory.GetAllTimeSamplingProfileRequest; result: Memory.GetAllTimeSamplingProfileResponse };
  "Memory.getBrowserSamplingProfile": { params: Memory.GetBrowserSamplingProfileRequest; result: Memory.GetBrowserSamplingProfileResponse };
  "Memory.getDOMCounters": { params: Memory.GetDOMCountersRequest; result: Memory.GetDOMCountersResponse };
  "Memory.getDOMCountersForLeakDetection": { params: Memory.GetDOMCountersForLeakDetectionRequest; result: Memory.GetDOMCountersForLeakDetectionResponse };
  "Memory.getSamplingProfile": { params: Memory.GetSamplingProfileRequest; result: Memory.GetSamplingProfileResponse };
  "Memory.prepareForLeakDetection": { params: Memory.PrepareForLeakDetectionRequest; result: Memory.PrepareForLeakDetectionResponse };
  "Memory.setPressureNotificationsSuppressed": { params: Memory.SetPressureNotificationsSuppressedRequest; result: Memory.SetPressureNotificationsSuppressedResponse };
  "Memory.simulatePressureNotification": { params: Memory.SimulatePressureNotificationRequest; result: Memory.SimulatePressureNotificationResponse };
  "Memory.startSampling": { params: Memory.StartSamplingRequest; result: Memory.StartSamplingResponse };
  "Memory.stopSampling": { params: Memory.StopSamplingRequest; result: Memory.StopSamplingResponse };
  "Network.canClearBrowserCache": { params: Network.CanClearBrowserCacheRequest; result: Network.CanClearBrowserCacheResponse };
  "Network.canClearBrowserCookies": { params: Network.CanClearBrowserCookiesRequest; result: Network.CanClearBrowserCookiesResponse };
  "Network.canEmulateNetworkConditions": { params: Network.CanEmulateNetworkConditionsRequest; result: Network.CanEmulateNetworkConditionsResponse };
  "Network.clearAcceptedEncodingsOverride": { params: Network.ClearAcceptedEncodingsOverrideRequest; result: Network.ClearAcceptedEncodingsOverrideResponse };
  "Network.clearBrowserCache": { params: Network.ClearBrowserCacheRequest; result: Network.ClearBrowserCacheResponse };
  "Network.clearBrowserCookies": { params: Network.ClearBrowserCookiesRequest; result: Network.ClearBrowserCookiesResponse };
  "Network.configureDurableMessages": { params: Network.ConfigureDurableMessagesRequest; result: Network.ConfigureDurableMessagesResponse };
  "Network.continueInterceptedRequest": { params: Network.ContinueInterceptedRequestRequest; result: Network.ContinueInterceptedRequestResponse };
  "Network.deleteCookies": { params: Network.DeleteCookiesRequest; result: Network.DeleteCookiesResponse };
  "Network.deleteDeviceBoundSession": { params: Network.DeleteDeviceBoundSessionRequest; result: Network.DeleteDeviceBoundSessionResponse };
  "Network.disable": { params: Network.DisableRequest; result: Network.DisableResponse };
  "Network.emulateNetworkConditions": { params: Network.EmulateNetworkConditionsRequest; result: Network.EmulateNetworkConditionsResponse };
  "Network.emulateNetworkConditionsByRule": { params: Network.EmulateNetworkConditionsByRuleRequest; result: Network.EmulateNetworkConditionsByRuleResponse };
  "Network.enable": { params: Network.EnableRequest; result: Network.EnableResponse };
  "Network.enableDeviceBoundSessions": { params: Network.EnableDeviceBoundSessionsRequest; result: Network.EnableDeviceBoundSessionsResponse };
  "Network.enableReportingApi": { params: Network.EnableReportingApiRequest; result: Network.EnableReportingApiResponse };
  "Network.fetchSchemefulSite": { params: Network.FetchSchemefulSiteRequest; result: Network.FetchSchemefulSiteResponse };
  "Network.getAllCookies": { params: Network.GetAllCookiesRequest; result: Network.GetAllCookiesResponse };
  "Network.getCertificate": { params: Network.GetCertificateRequest; result: Network.GetCertificateResponse };
  "Network.getCookies": { params: Network.GetCookiesRequest; result: Network.GetCookiesResponse };
  "Network.getRequestPostData": { params: Network.GetRequestPostDataRequest; result: Network.GetRequestPostDataResponse };
  "Network.getResponseBody": { params: Network.GetResponseBodyRequest; result: Network.GetResponseBodyResponse };
  "Network.getResponseBodyForInterception": { params: Network.GetResponseBodyForInterceptionRequest; result: Network.GetResponseBodyForInterceptionResponse };
  "Network.getSecurityIsolationStatus": { params: Network.GetSecurityIsolationStatusRequest; result: Network.GetSecurityIsolationStatusResponse };
  "Network.loadNetworkResource": { params: Network.LoadNetworkResourceRequest; result: Network.LoadNetworkResourceResponse };
  "Network.overrideNetworkState": { params: Network.OverrideNetworkStateRequest; result: Network.OverrideNetworkStateResponse };
  "Network.replayXHR": { params: Network.ReplayXHRRequest; result: Network.ReplayXHRResponse };
  "Network.searchInResponseBody": { params: Network.SearchInResponseBodyRequest; result: Network.SearchInResponseBodyResponse };
  "Network.setAcceptedEncodings": { params: Network.SetAcceptedEncodingsRequest; result: Network.SetAcceptedEncodingsResponse };
  "Network.setAttachDebugStack": { params: Network.SetAttachDebugStackRequest; result: Network.SetAttachDebugStackResponse };
  "Network.setBlockedURLs": { params: Network.SetBlockedURLsRequest; result: Network.SetBlockedURLsResponse };
  "Network.setBypassServiceWorker": { params: Network.SetBypassServiceWorkerRequest; result: Network.SetBypassServiceWorkerResponse };
  "Network.setCacheDisabled": { params: Network.SetCacheDisabledRequest; result: Network.SetCacheDisabledResponse };
  "Network.setCookie": { params: Network.SetCookieRequest; result: Network.SetCookieResponse };
  "Network.setCookieControls": { params: Network.SetCookieControlsRequest; result: Network.SetCookieControlsResponse };
  "Network.setCookies": { params: Network.SetCookiesRequest; result: Network.SetCookiesResponse };
  "Network.setExtraHTTPHeaders": { params: Network.SetExtraHTTPHeadersRequest; result: Network.SetExtraHTTPHeadersResponse };
  "Network.setRequestInterception": { params: Network.SetRequestInterceptionRequest; result: Network.SetRequestInterceptionResponse };
  "Network.streamResourceContent": { params: Network.StreamResourceContentRequest; result: Network.StreamResourceContentResponse };
  "Network.takeResponseBodyForInterceptionAsStream": { params: Network.TakeResponseBodyForInterceptionAsStreamRequest; result: Network.TakeResponseBodyForInterceptionAsStreamResponse };
  "Overlay.disable": { params: Overlay.DisableRequest; result: Overlay.DisableResponse };
  "Overlay.enable": { params: Overlay.EnableRequest; result: Overlay.EnableResponse };
  "Overlay.getGridHighlightObjectsForTest": { params: Overlay.GetGridHighlightObjectsForTestRequest; result: Overlay.GetGridHighlightObjectsForTestResponse };
  "Overlay.getHighlightObjectForTest": { params: Overlay.GetHighlightObjectForTestRequest; result: Overlay.GetHighlightObjectForTestResponse };
  "Overlay.getSourceOrderHighlightObjectForTest": { params: Overlay.GetSourceOrderHighlightObjectForTestRequest; result: Overlay.GetSourceOrderHighlightObjectForTestResponse };
  "Overlay.hideHighlight": { params: Overlay.HideHighlightRequest; result: Overlay.HideHighlightResponse };
  "Overlay.highlightFrame": { params: Overlay.HighlightFrameRequest; result: Overlay.HighlightFrameResponse };
  "Overlay.highlightNode": { params: Overlay.HighlightNodeRequest; result: Overlay.HighlightNodeResponse };
  "Overlay.highlightQuad": { params: Overlay.HighlightQuadRequest; result: Overlay.HighlightQuadResponse };
  "Overlay.highlightRect": { params: Overlay.HighlightRectRequest; result: Overlay.HighlightRectResponse };
  "Overlay.highlightSourceOrder": { params: Overlay.HighlightSourceOrderRequest; result: Overlay.HighlightSourceOrderResponse };
  "Overlay.setInspectMode": { params: Overlay.SetInspectModeRequest; result: Overlay.SetInspectModeResponse };
  "Overlay.setPausedInDebuggerMessage": { params: Overlay.SetPausedInDebuggerMessageRequest; result: Overlay.SetPausedInDebuggerMessageResponse };
  "Overlay.setShowAdHighlights": { params: Overlay.SetShowAdHighlightsRequest; result: Overlay.SetShowAdHighlightsResponse };
  "Overlay.setShowContainerQueryOverlays": { params: Overlay.SetShowContainerQueryOverlaysRequest; result: Overlay.SetShowContainerQueryOverlaysResponse };
  "Overlay.setShowDebugBorders": { params: Overlay.SetShowDebugBordersRequest; result: Overlay.SetShowDebugBordersResponse };
  "Overlay.setShowFlexOverlays": { params: Overlay.SetShowFlexOverlaysRequest; result: Overlay.SetShowFlexOverlaysResponse };
  "Overlay.setShowFPSCounter": { params: Overlay.SetShowFPSCounterRequest; result: Overlay.SetShowFPSCounterResponse };
  "Overlay.setShowGridOverlays": { params: Overlay.SetShowGridOverlaysRequest; result: Overlay.SetShowGridOverlaysResponse };
  "Overlay.setShowHinge": { params: Overlay.SetShowHingeRequest; result: Overlay.SetShowHingeResponse };
  "Overlay.setShowHitTestBorders": { params: Overlay.SetShowHitTestBordersRequest; result: Overlay.SetShowHitTestBordersResponse };
  "Overlay.setShowInspectedElementAnchor": { params: Overlay.SetShowInspectedElementAnchorRequest; result: Overlay.SetShowInspectedElementAnchorResponse };
  "Overlay.setShowIsolatedElements": { params: Overlay.SetShowIsolatedElementsRequest; result: Overlay.SetShowIsolatedElementsResponse };
  "Overlay.setShowLayoutShiftRegions": { params: Overlay.SetShowLayoutShiftRegionsRequest; result: Overlay.SetShowLayoutShiftRegionsResponse };
  "Overlay.setShowPaintRects": { params: Overlay.SetShowPaintRectsRequest; result: Overlay.SetShowPaintRectsResponse };
  "Overlay.setShowScrollBottleneckRects": { params: Overlay.SetShowScrollBottleneckRectsRequest; result: Overlay.SetShowScrollBottleneckRectsResponse };
  "Overlay.setShowScrollSnapOverlays": { params: Overlay.SetShowScrollSnapOverlaysRequest; result: Overlay.SetShowScrollSnapOverlaysResponse };
  "Overlay.setShowViewportSizeOnResize": { params: Overlay.SetShowViewportSizeOnResizeRequest; result: Overlay.SetShowViewportSizeOnResizeResponse };
  "Overlay.setShowWebVitals": { params: Overlay.SetShowWebVitalsRequest; result: Overlay.SetShowWebVitalsResponse };
  "Overlay.setShowWindowControlsOverlay": { params: Overlay.SetShowWindowControlsOverlayRequest; result: Overlay.SetShowWindowControlsOverlayResponse };
  "Page.addCompilationCache": { params: Page.AddCompilationCacheRequest; result: Page.AddCompilationCacheResponse };
  "Page.addScriptToEvaluateOnLoad": { params: Page.AddScriptToEvaluateOnLoadRequest; result: Page.AddScriptToEvaluateOnLoadResponse };
  "Page.addScriptToEvaluateOnNewDocument": { params: Page.AddScriptToEvaluateOnNewDocumentRequest; result: Page.AddScriptToEvaluateOnNewDocumentResponse };
  "Page.bringToFront": { params: Page.BringToFrontRequest; result: Page.BringToFrontResponse };
  "Page.captureScreenshot": { params: Page.CaptureScreenshotRequest; result: Page.CaptureScreenshotResponse };
  "Page.captureSnapshot": { params: Page.CaptureSnapshotRequest; result: Page.CaptureSnapshotResponse };
  "Page.clearCompilationCache": { params: Page.ClearCompilationCacheRequest; result: Page.ClearCompilationCacheResponse };
  "Page.close": { params: Page.CloseRequest; result: Page.CloseResponse };
  "Page.crash": { params: Page.CrashRequest; result: Page.CrashResponse };
  "Page.createIsolatedWorld": { params: Page.CreateIsolatedWorldRequest; result: Page.CreateIsolatedWorldResponse };
  "Page.disable": { params: Page.DisableRequest; result: Page.DisableResponse };
  "Page.enable": { params: Page.EnableRequest; result: Page.EnableResponse };
  "Page.generateTestReport": { params: Page.GenerateTestReportRequest; result: Page.GenerateTestReportResponse };
  "Page.getAdScriptAncestry": { params: Page.GetAdScriptAncestryRequest; result: Page.GetAdScriptAncestryResponse };
  "Page.getAnnotatedPageContent": { params: Page.GetAnnotatedPageContentRequest; result: Page.GetAnnotatedPageContentResponse };
  "Page.getAppId": { params: Page.GetAppIdRequest; result: Page.GetAppIdResponse };
  "Page.getAppManifest": { params: Page.GetAppManifestRequest; result: Page.GetAppManifestResponse };
  "Page.getFrameTree": { params: Page.GetFrameTreeRequest; result: Page.GetFrameTreeResponse };
  "Page.getInstallabilityErrors": { params: Page.GetInstallabilityErrorsRequest; result: Page.GetInstallabilityErrorsResponse };
  "Page.getLayoutMetrics": { params: Page.GetLayoutMetricsRequest; result: Page.GetLayoutMetricsResponse };
  "Page.getManifestIcons": { params: Page.GetManifestIconsRequest; result: Page.GetManifestIconsResponse };
  "Page.getNavigationHistory": { params: Page.GetNavigationHistoryRequest; result: Page.GetNavigationHistoryResponse };
  "Page.getOriginTrials": { params: Page.GetOriginTrialsRequest; result: Page.GetOriginTrialsResponse };
  "Page.getPermissionsPolicyState": { params: Page.GetPermissionsPolicyStateRequest; result: Page.GetPermissionsPolicyStateResponse };
  "Page.getResourceContent": { params: Page.GetResourceContentRequest; result: Page.GetResourceContentResponse };
  "Page.getResourceTree": { params: Page.GetResourceTreeRequest; result: Page.GetResourceTreeResponse };
  "Page.handleJavaScriptDialog": { params: Page.HandleJavaScriptDialogRequest; result: Page.HandleJavaScriptDialogResponse };
  "Page.navigate": { params: Page.NavigateRequest; result: Page.NavigateResponse };
  "Page.navigateToHistoryEntry": { params: Page.NavigateToHistoryEntryRequest; result: Page.NavigateToHistoryEntryResponse };
  "Page.printToPDF": { params: Page.PrintToPDFRequest; result: Page.PrintToPDFResponse };
  "Page.produceCompilationCache": { params: Page.ProduceCompilationCacheRequest; result: Page.ProduceCompilationCacheResponse };
  "Page.reload": { params: Page.ReloadRequest; result: Page.ReloadResponse };
  "Page.removeScriptToEvaluateOnLoad": { params: Page.RemoveScriptToEvaluateOnLoadRequest; result: Page.RemoveScriptToEvaluateOnLoadResponse };
  "Page.removeScriptToEvaluateOnNewDocument": { params: Page.RemoveScriptToEvaluateOnNewDocumentRequest; result: Page.RemoveScriptToEvaluateOnNewDocumentResponse };
  "Page.resetNavigationHistory": { params: Page.ResetNavigationHistoryRequest; result: Page.ResetNavigationHistoryResponse };
  "Page.screencastFrameAck": { params: Page.ScreencastFrameAckRequest; result: Page.ScreencastFrameAckResponse };
  "Page.searchInResource": { params: Page.SearchInResourceRequest; result: Page.SearchInResourceResponse };
  "Page.setAdBlockingEnabled": { params: Page.SetAdBlockingEnabledRequest; result: Page.SetAdBlockingEnabledResponse };
  "Page.setBypassCSP": { params: Page.SetBypassCSPRequest; result: Page.SetBypassCSPResponse };
  "Page.setDocumentContent": { params: Page.SetDocumentContentRequest; result: Page.SetDocumentContentResponse };
  "Page.setDownloadBehavior": { params: Page.SetDownloadBehaviorRequest; result: Page.SetDownloadBehaviorResponse };
  "Page.setFontFamilies": { params: Page.SetFontFamiliesRequest; result: Page.SetFontFamiliesResponse };
  "Page.setFontSizes": { params: Page.SetFontSizesRequest; result: Page.SetFontSizesResponse };
  "Page.setInterceptFileChooserDialog": { params: Page.SetInterceptFileChooserDialogRequest; result: Page.SetInterceptFileChooserDialogResponse };
  "Page.setLifecycleEventsEnabled": { params: Page.SetLifecycleEventsEnabledRequest; result: Page.SetLifecycleEventsEnabledResponse };
  "Page.setPrerenderingAllowed": { params: Page.SetPrerenderingAllowedRequest; result: Page.SetPrerenderingAllowedResponse };
  "Page.setRPHRegistrationMode": { params: Page.SetRPHRegistrationModeRequest; result: Page.SetRPHRegistrationModeResponse };
  "Page.setSPCTransactionMode": { params: Page.SetSPCTransactionModeRequest; result: Page.SetSPCTransactionModeResponse };
  "Page.setWebLifecycleState": { params: Page.SetWebLifecycleStateRequest; result: Page.SetWebLifecycleStateResponse };
  "Page.startScreencast": { params: Page.StartScreencastRequest; result: Page.StartScreencastResponse };
  "Page.stopLoading": { params: Page.StopLoadingRequest; result: Page.StopLoadingResponse };
  "Page.stopScreencast": { params: Page.StopScreencastRequest; result: Page.StopScreencastResponse };
  "Page.waitForDebugger": { params: Page.WaitForDebuggerRequest; result: Page.WaitForDebuggerResponse };
  "Performance.disable": { params: Performance.DisableRequest; result: Performance.DisableResponse };
  "Performance.enable": { params: Performance.EnableRequest; result: Performance.EnableResponse };
  "Performance.getMetrics": { params: Performance.GetMetricsRequest; result: Performance.GetMetricsResponse };
  "Performance.setTimeDomain": { params: Performance.SetTimeDomainRequest; result: Performance.SetTimeDomainResponse };
  "PerformanceTimeline.enable": { params: PerformanceTimeline.EnableRequest; result: PerformanceTimeline.EnableResponse };
  "Preload.disable": { params: Preload.DisableRequest; result: Preload.DisableResponse };
  "Preload.enable": { params: Preload.EnableRequest; result: Preload.EnableResponse };
  "Profiler.disable": { params: Profiler.DisableRequest; result: Profiler.DisableResponse };
  "Profiler.enable": { params: Profiler.EnableRequest; result: Profiler.EnableResponse };
  "Profiler.getBestEffortCoverage": { params: Profiler.GetBestEffortCoverageRequest; result: Profiler.GetBestEffortCoverageResponse };
  "Profiler.setSamplingInterval": { params: Profiler.SetSamplingIntervalRequest; result: Profiler.SetSamplingIntervalResponse };
  "Profiler.start": { params: Profiler.StartRequest; result: Profiler.StartResponse };
  "Profiler.startPreciseCoverage": { params: Profiler.StartPreciseCoverageRequest; result: Profiler.StartPreciseCoverageResponse };
  "Profiler.stop": { params: Profiler.StopRequest; result: Profiler.StopResponse };
  "Profiler.stopPreciseCoverage": { params: Profiler.StopPreciseCoverageRequest; result: Profiler.StopPreciseCoverageResponse };
  "Profiler.takePreciseCoverage": { params: Profiler.TakePreciseCoverageRequest; result: Profiler.TakePreciseCoverageResponse };
  "PWA.changeAppUserSettings": { params: PWA.ChangeAppUserSettingsRequest; result: PWA.ChangeAppUserSettingsResponse };
  "PWA.getOsAppState": { params: PWA.GetOsAppStateRequest; result: PWA.GetOsAppStateResponse };
  "PWA.install": { params: PWA.InstallRequest; result: PWA.InstallResponse };
  "PWA.launch": { params: PWA.LaunchRequest; result: PWA.LaunchResponse };
  "PWA.launchFilesInApp": { params: PWA.LaunchFilesInAppRequest; result: PWA.LaunchFilesInAppResponse };
  "PWA.openCurrentPageInApp": { params: PWA.OpenCurrentPageInAppRequest; result: PWA.OpenCurrentPageInAppResponse };
  "PWA.uninstall": { params: PWA.UninstallRequest; result: PWA.UninstallResponse };
  "Runtime.addBinding": { params: Runtime.AddBindingRequest; result: Runtime.AddBindingResponse };
  "Runtime.awaitPromise": { params: Runtime.AwaitPromiseRequest; result: Runtime.AwaitPromiseResponse };
  "Runtime.callFunctionOn": { params: Runtime.CallFunctionOnRequest; result: Runtime.CallFunctionOnResponse };
  "Runtime.compileScript": { params: Runtime.CompileScriptRequest; result: Runtime.CompileScriptResponse };
  "Runtime.disable": { params: Runtime.DisableRequest; result: Runtime.DisableResponse };
  "Runtime.discardConsoleEntries": { params: Runtime.DiscardConsoleEntriesRequest; result: Runtime.DiscardConsoleEntriesResponse };
  "Runtime.enable": { params: Runtime.EnableRequest; result: Runtime.EnableResponse };
  "Runtime.evaluate": { params: Runtime.EvaluateRequest; result: Runtime.EvaluateResponse };
  "Runtime.getExceptionDetails": { params: Runtime.GetExceptionDetailsRequest; result: Runtime.GetExceptionDetailsResponse };
  "Runtime.getHeapUsage": { params: Runtime.GetHeapUsageRequest; result: Runtime.GetHeapUsageResponse };
  "Runtime.getIsolateId": { params: Runtime.GetIsolateIdRequest; result: Runtime.GetIsolateIdResponse };
  "Runtime.getProperties": { params: Runtime.GetPropertiesRequest; result: Runtime.GetPropertiesResponse };
  "Runtime.globalLexicalScopeNames": { params: Runtime.GlobalLexicalScopeNamesRequest; result: Runtime.GlobalLexicalScopeNamesResponse };
  "Runtime.queryObjects": { params: Runtime.QueryObjectsRequest; result: Runtime.QueryObjectsResponse };
  "Runtime.releaseObject": { params: Runtime.ReleaseObjectRequest; result: Runtime.ReleaseObjectResponse };
  "Runtime.releaseObjectGroup": { params: Runtime.ReleaseObjectGroupRequest; result: Runtime.ReleaseObjectGroupResponse };
  "Runtime.removeBinding": { params: Runtime.RemoveBindingRequest; result: Runtime.RemoveBindingResponse };
  "Runtime.runIfWaitingForDebugger": { params: Runtime.RunIfWaitingForDebuggerRequest; result: Runtime.RunIfWaitingForDebuggerResponse };
  "Runtime.runScript": { params: Runtime.RunScriptRequest; result: Runtime.RunScriptResponse };
  "Runtime.setCustomObjectFormatterEnabled": { params: Runtime.SetCustomObjectFormatterEnabledRequest; result: Runtime.SetCustomObjectFormatterEnabledResponse };
  "Runtime.setMaxCallStackSizeToCapture": { params: Runtime.SetMaxCallStackSizeToCaptureRequest; result: Runtime.SetMaxCallStackSizeToCaptureResponse };
  "Runtime.terminateExecution": { params: Runtime.TerminateExecutionRequest; result: Runtime.TerminateExecutionResponse };
  "Schema.getDomains": { params: Schema.GetDomainsRequest; result: Schema.GetDomainsResponse };
  "Security.disable": { params: Security.DisableRequest; result: Security.DisableResponse };
  "Security.enable": { params: Security.EnableRequest; result: Security.EnableResponse };
  "Security.handleCertificateError": { params: Security.HandleCertificateErrorRequest; result: Security.HandleCertificateErrorResponse };
  "Security.setIgnoreCertificateErrors": { params: Security.SetIgnoreCertificateErrorsRequest; result: Security.SetIgnoreCertificateErrorsResponse };
  "Security.setOverrideCertificateErrors": { params: Security.SetOverrideCertificateErrorsRequest; result: Security.SetOverrideCertificateErrorsResponse };
  "ServiceWorker.deliverPushMessage": { params: ServiceWorker.DeliverPushMessageRequest; result: ServiceWorker.DeliverPushMessageResponse };
  "ServiceWorker.disable": { params: ServiceWorker.DisableRequest; result: ServiceWorker.DisableResponse };
  "ServiceWorker.dispatchPeriodicSyncEvent": { params: ServiceWorker.DispatchPeriodicSyncEventRequest; result: ServiceWorker.DispatchPeriodicSyncEventResponse };
  "ServiceWorker.dispatchSyncEvent": { params: ServiceWorker.DispatchSyncEventRequest; result: ServiceWorker.DispatchSyncEventResponse };
  "ServiceWorker.enable": { params: ServiceWorker.EnableRequest; result: ServiceWorker.EnableResponse };
  "ServiceWorker.setForceUpdateOnPageLoad": { params: ServiceWorker.SetForceUpdateOnPageLoadRequest; result: ServiceWorker.SetForceUpdateOnPageLoadResponse };
  "ServiceWorker.skipWaiting": { params: ServiceWorker.SkipWaitingRequest; result: ServiceWorker.SkipWaitingResponse };
  "ServiceWorker.startWorker": { params: ServiceWorker.StartWorkerRequest; result: ServiceWorker.StartWorkerResponse };
  "ServiceWorker.stopAllWorkers": { params: ServiceWorker.StopAllWorkersRequest; result: ServiceWorker.StopAllWorkersResponse };
  "ServiceWorker.stopWorker": { params: ServiceWorker.StopWorkerRequest; result: ServiceWorker.StopWorkerResponse };
  "ServiceWorker.unregister": { params: ServiceWorker.UnregisterRequest; result: ServiceWorker.UnregisterResponse };
  "ServiceWorker.updateRegistration": { params: ServiceWorker.UpdateRegistrationRequest; result: ServiceWorker.UpdateRegistrationResponse };
  "SmartCardEmulation.disable": { params: SmartCardEmulation.DisableRequest; result: SmartCardEmulation.DisableResponse };
  "SmartCardEmulation.enable": { params: SmartCardEmulation.EnableRequest; result: SmartCardEmulation.EnableResponse };
  "SmartCardEmulation.reportBeginTransactionResult": { params: SmartCardEmulation.ReportBeginTransactionResultRequest; result: SmartCardEmulation.ReportBeginTransactionResultResponse };
  "SmartCardEmulation.reportConnectResult": { params: SmartCardEmulation.ReportConnectResultRequest; result: SmartCardEmulation.ReportConnectResultResponse };
  "SmartCardEmulation.reportDataResult": { params: SmartCardEmulation.ReportDataResultRequest; result: SmartCardEmulation.ReportDataResultResponse };
  "SmartCardEmulation.reportError": { params: SmartCardEmulation.ReportErrorRequest; result: SmartCardEmulation.ReportErrorResponse };
  "SmartCardEmulation.reportEstablishContextResult": { params: SmartCardEmulation.ReportEstablishContextResultRequest; result: SmartCardEmulation.ReportEstablishContextResultResponse };
  "SmartCardEmulation.reportGetStatusChangeResult": { params: SmartCardEmulation.ReportGetStatusChangeResultRequest; result: SmartCardEmulation.ReportGetStatusChangeResultResponse };
  "SmartCardEmulation.reportListReadersResult": { params: SmartCardEmulation.ReportListReadersResultRequest; result: SmartCardEmulation.ReportListReadersResultResponse };
  "SmartCardEmulation.reportPlainResult": { params: SmartCardEmulation.ReportPlainResultRequest; result: SmartCardEmulation.ReportPlainResultResponse };
  "SmartCardEmulation.reportReleaseContextResult": { params: SmartCardEmulation.ReportReleaseContextResultRequest; result: SmartCardEmulation.ReportReleaseContextResultResponse };
  "SmartCardEmulation.reportStatusResult": { params: SmartCardEmulation.ReportStatusResultRequest; result: SmartCardEmulation.ReportStatusResultResponse };
  "Storage.clearCookies": { params: Storage.ClearCookiesRequest; result: Storage.ClearCookiesResponse };
  "Storage.clearDataForOrigin": { params: Storage.ClearDataForOriginRequest; result: Storage.ClearDataForOriginResponse };
  "Storage.clearDataForStorageKey": { params: Storage.ClearDataForStorageKeyRequest; result: Storage.ClearDataForStorageKeyResponse };
  "Storage.clearSharedStorageEntries": { params: Storage.ClearSharedStorageEntriesRequest; result: Storage.ClearSharedStorageEntriesResponse };
  "Storage.clearTrustTokens": { params: Storage.ClearTrustTokensRequest; result: Storage.ClearTrustTokensResponse };
  "Storage.deleteSharedStorageEntry": { params: Storage.DeleteSharedStorageEntryRequest; result: Storage.DeleteSharedStorageEntryResponse };
  "Storage.deleteStorageBucket": { params: Storage.DeleteStorageBucketRequest; result: Storage.DeleteStorageBucketResponse };
  "Storage.getCookies": { params: Storage.GetCookiesRequest; result: Storage.GetCookiesResponse };
  "Storage.getInterestGroupDetails": { params: Storage.GetInterestGroupDetailsRequest; result: Storage.GetInterestGroupDetailsResponse };
  "Storage.getRelatedWebsiteSets": { params: Storage.GetRelatedWebsiteSetsRequest; result: Storage.GetRelatedWebsiteSetsResponse };
  "Storage.getSharedStorageEntries": { params: Storage.GetSharedStorageEntriesRequest; result: Storage.GetSharedStorageEntriesResponse };
  "Storage.getSharedStorageMetadata": { params: Storage.GetSharedStorageMetadataRequest; result: Storage.GetSharedStorageMetadataResponse };
  "Storage.getStorageKey": { params: Storage.GetStorageKeyRequest; result: Storage.GetStorageKeyResponse };
  "Storage.getStorageKeyForFrame": { params: Storage.GetStorageKeyForFrameRequest; result: Storage.GetStorageKeyForFrameResponse };
  "Storage.getTrustTokens": { params: Storage.GetTrustTokensRequest; result: Storage.GetTrustTokensResponse };
  "Storage.getUsageAndQuota": { params: Storage.GetUsageAndQuotaRequest; result: Storage.GetUsageAndQuotaResponse };
  "Storage.overrideQuotaForOrigin": { params: Storage.OverrideQuotaForOriginRequest; result: Storage.OverrideQuotaForOriginResponse };
  "Storage.resetSharedStorageBudget": { params: Storage.ResetSharedStorageBudgetRequest; result: Storage.ResetSharedStorageBudgetResponse };
  "Storage.runBounceTrackingMitigations": { params: Storage.RunBounceTrackingMitigationsRequest; result: Storage.RunBounceTrackingMitigationsResponse };
  "Storage.setCookies": { params: Storage.SetCookiesRequest; result: Storage.SetCookiesResponse };
  "Storage.setInterestGroupAuctionTracking": { params: Storage.SetInterestGroupAuctionTrackingRequest; result: Storage.SetInterestGroupAuctionTrackingResponse };
  "Storage.setInterestGroupTracking": { params: Storage.SetInterestGroupTrackingRequest; result: Storage.SetInterestGroupTrackingResponse };
  "Storage.setProtectedAudienceKAnonymity": { params: Storage.SetProtectedAudienceKAnonymityRequest; result: Storage.SetProtectedAudienceKAnonymityResponse };
  "Storage.setSharedStorageEntry": { params: Storage.SetSharedStorageEntryRequest; result: Storage.SetSharedStorageEntryResponse };
  "Storage.setSharedStorageTracking": { params: Storage.SetSharedStorageTrackingRequest; result: Storage.SetSharedStorageTrackingResponse };
  "Storage.setStorageBucketTracking": { params: Storage.SetStorageBucketTrackingRequest; result: Storage.SetStorageBucketTrackingResponse };
  "Storage.trackCacheStorageForOrigin": { params: Storage.TrackCacheStorageForOriginRequest; result: Storage.TrackCacheStorageForOriginResponse };
  "Storage.trackCacheStorageForStorageKey": { params: Storage.TrackCacheStorageForStorageKeyRequest; result: Storage.TrackCacheStorageForStorageKeyResponse };
  "Storage.trackIndexedDBForOrigin": { params: Storage.TrackIndexedDBForOriginRequest; result: Storage.TrackIndexedDBForOriginResponse };
  "Storage.trackIndexedDBForStorageKey": { params: Storage.TrackIndexedDBForStorageKeyRequest; result: Storage.TrackIndexedDBForStorageKeyResponse };
  "Storage.untrackCacheStorageForOrigin": { params: Storage.UntrackCacheStorageForOriginRequest; result: Storage.UntrackCacheStorageForOriginResponse };
  "Storage.untrackCacheStorageForStorageKey": { params: Storage.UntrackCacheStorageForStorageKeyRequest; result: Storage.UntrackCacheStorageForStorageKeyResponse };
  "Storage.untrackIndexedDBForOrigin": { params: Storage.UntrackIndexedDBForOriginRequest; result: Storage.UntrackIndexedDBForOriginResponse };
  "Storage.untrackIndexedDBForStorageKey": { params: Storage.UntrackIndexedDBForStorageKeyRequest; result: Storage.UntrackIndexedDBForStorageKeyResponse };
  "SystemInfo.getFeatureState": { params: SystemInfo.GetFeatureStateRequest; result: SystemInfo.GetFeatureStateResponse };
  "SystemInfo.getInfo": { params: SystemInfo.GetInfoRequest; result: SystemInfo.GetInfoResponse };
  "SystemInfo.getProcessInfo": { params: SystemInfo.GetProcessInfoRequest; result: SystemInfo.GetProcessInfoResponse };
  "Target.activateTarget": { params: Target.ActivateTargetRequest; result: Target.ActivateTargetResponse };
  "Target.attachToBrowserTarget": { params: Target.AttachToBrowserTargetRequest; result: Target.AttachToBrowserTargetResponse };
  "Target.attachToTarget": { params: Target.AttachToTargetRequest; result: Target.AttachToTargetResponse };
  "Target.autoAttachRelated": { params: Target.AutoAttachRelatedRequest; result: Target.AutoAttachRelatedResponse };
  "Target.closeTarget": { params: Target.CloseTargetRequest; result: Target.CloseTargetResponse };
  "Target.createBrowserContext": { params: Target.CreateBrowserContextRequest; result: Target.CreateBrowserContextResponse };
  "Target.createTarget": { params: Target.CreateTargetRequest; result: Target.CreateTargetResponse };
  "Target.detachFromTarget": { params: Target.DetachFromTargetRequest; result: Target.DetachFromTargetResponse };
  "Target.disposeBrowserContext": { params: Target.DisposeBrowserContextRequest; result: Target.DisposeBrowserContextResponse };
  "Target.exposeDevToolsProtocol": { params: Target.ExposeDevToolsProtocolRequest; result: Target.ExposeDevToolsProtocolResponse };
  "Target.getBrowserContexts": { params: Target.GetBrowserContextsRequest; result: Target.GetBrowserContextsResponse };
  "Target.getDevToolsTarget": { params: Target.GetDevToolsTargetRequest; result: Target.GetDevToolsTargetResponse };
  "Target.getTargetInfo": { params: Target.GetTargetInfoRequest; result: Target.GetTargetInfoResponse };
  "Target.getTargets": { params: Target.GetTargetsRequest; result: Target.GetTargetsResponse };
  "Target.openDevTools": { params: Target.OpenDevToolsRequest; result: Target.OpenDevToolsResponse };
  "Target.sendMessageToTarget": { params: Target.SendMessageToTargetRequest; result: Target.SendMessageToTargetResponse };
  "Target.setAutoAttach": { params: Target.SetAutoAttachRequest; result: Target.SetAutoAttachResponse };
  "Target.setDiscoverTargets": { params: Target.SetDiscoverTargetsRequest; result: Target.SetDiscoverTargetsResponse };
  "Target.setRemoteLocations": { params: Target.SetRemoteLocationsRequest; result: Target.SetRemoteLocationsResponse };
  "Tethering.bind": { params: Tethering.BindRequest; result: Tethering.BindResponse };
  "Tethering.unbind": { params: Tethering.UnbindRequest; result: Tethering.UnbindResponse };
  "Tracing.end": { params: Tracing.EndRequest; result: Tracing.EndResponse };
  "Tracing.getCategories": { params: Tracing.GetCategoriesRequest; result: Tracing.GetCategoriesResponse };
  "Tracing.getTrackEventDescriptor": { params: Tracing.GetTrackEventDescriptorRequest; result: Tracing.GetTrackEventDescriptorResponse };
  "Tracing.recordClockSyncMarker": { params: Tracing.RecordClockSyncMarkerRequest; result: Tracing.RecordClockSyncMarkerResponse };
  "Tracing.requestMemoryDump": { params: Tracing.RequestMemoryDumpRequest; result: Tracing.RequestMemoryDumpResponse };
  "Tracing.start": { params: Tracing.StartRequest; result: Tracing.StartResponse };
  "WebAudio.disable": { params: WebAudio.DisableRequest; result: WebAudio.DisableResponse };
  "WebAudio.enable": { params: WebAudio.EnableRequest; result: WebAudio.EnableResponse };
  "WebAudio.getRealtimeData": { params: WebAudio.GetRealtimeDataRequest; result: WebAudio.GetRealtimeDataResponse };
  "WebAuthn.addCredential": { params: WebAuthn.AddCredentialRequest; result: WebAuthn.AddCredentialResponse };
  "WebAuthn.addVirtualAuthenticator": { params: WebAuthn.AddVirtualAuthenticatorRequest; result: WebAuthn.AddVirtualAuthenticatorResponse };
  "WebAuthn.clearCredentials": { params: WebAuthn.ClearCredentialsRequest; result: WebAuthn.ClearCredentialsResponse };
  "WebAuthn.disable": { params: WebAuthn.DisableRequest; result: WebAuthn.DisableResponse };
  "WebAuthn.enable": { params: WebAuthn.EnableRequest; result: WebAuthn.EnableResponse };
  "WebAuthn.getCredential": { params: WebAuthn.GetCredentialRequest; result: WebAuthn.GetCredentialResponse };
  "WebAuthn.getCredentials": { params: WebAuthn.GetCredentialsRequest; result: WebAuthn.GetCredentialsResponse };
  "WebAuthn.removeCredential": { params: WebAuthn.RemoveCredentialRequest; result: WebAuthn.RemoveCredentialResponse };
  "WebAuthn.removeVirtualAuthenticator": { params: WebAuthn.RemoveVirtualAuthenticatorRequest; result: WebAuthn.RemoveVirtualAuthenticatorResponse };
  "WebAuthn.setAutomaticPresenceSimulation": { params: WebAuthn.SetAutomaticPresenceSimulationRequest; result: WebAuthn.SetAutomaticPresenceSimulationResponse };
  "WebAuthn.setCredentialProperties": { params: WebAuthn.SetCredentialPropertiesRequest; result: WebAuthn.SetCredentialPropertiesResponse };
  "WebAuthn.setResponseOverrideBits": { params: WebAuthn.SetResponseOverrideBitsRequest; result: WebAuthn.SetResponseOverrideBitsResponse };
  "WebAuthn.setUserVerified": { params: WebAuthn.SetUserVerifiedRequest; result: WebAuthn.SetUserVerifiedResponse };
  "WebMCP.cancelInvocation": { params: WebMCP.CancelInvocationRequest; result: WebMCP.CancelInvocationResponse };
  "WebMCP.disable": { params: WebMCP.DisableRequest; result: WebMCP.DisableResponse };
  "WebMCP.enable": { params: WebMCP.EnableRequest; result: WebMCP.EnableResponse };
  "WebMCP.invokeTool": { params: WebMCP.InvokeToolRequest; result: WebMCP.InvokeToolResponse };
}

export interface CdpEvents {
  "Accessibility.loadComplete": Accessibility.LoadCompleteEvent;
  "Accessibility.nodesUpdated": Accessibility.NodesUpdatedEvent;
  "Animation.animationCanceled": Animation.AnimationCanceledEvent;
  "Animation.animationCreated": Animation.AnimationCreatedEvent;
  "Animation.animationStarted": Animation.AnimationStartedEvent;
  "Animation.animationUpdated": Animation.AnimationUpdatedEvent;
  "Audits.issueAdded": Audits.IssueAddedEvent;
  "Autofill.addressFormFilled": Autofill.AddressFormFilledEvent;
  "BackgroundService.backgroundServiceEventReceived": BackgroundService.BackgroundServiceEventReceivedEvent;
  "BackgroundService.recordingStateChanged": BackgroundService.RecordingStateChangedEvent;
  "BluetoothEmulation.characteristicOperationReceived": BluetoothEmulation.CharacteristicOperationReceivedEvent;
  "BluetoothEmulation.descriptorOperationReceived": BluetoothEmulation.DescriptorOperationReceivedEvent;
  "BluetoothEmulation.gattOperationReceived": BluetoothEmulation.GattOperationReceivedEvent;
  "Browser.downloadProgress": Browser.DownloadProgressEvent;
  "Browser.downloadWillBegin": Browser.DownloadWillBeginEvent;
  "Cast.issueUpdated": Cast.IssueUpdatedEvent;
  "Cast.sinksUpdated": Cast.SinksUpdatedEvent;
  "Console.messageAdded": Console.MessageAddedEvent;
  "CSS.computedStyleUpdated": CSS.ComputedStyleUpdatedEvent;
  "CSS.fontsUpdated": CSS.FontsUpdatedEvent;
  "CSS.mediaQueryResultChanged": CSS.MediaQueryResultChangedEvent;
  "CSS.styleSheetAdded": CSS.StyleSheetAddedEvent;
  "CSS.styleSheetChanged": CSS.StyleSheetChangedEvent;
  "CSS.styleSheetRemoved": CSS.StyleSheetRemovedEvent;
  "Debugger.breakpointResolved": Debugger.BreakpointResolvedEvent;
  "Debugger.paused": Debugger.PausedEvent;
  "Debugger.resumed": Debugger.ResumedEvent;
  "Debugger.scriptFailedToParse": Debugger.ScriptFailedToParseEvent;
  "Debugger.scriptParsed": Debugger.ScriptParsedEvent;
  "DeviceAccess.deviceRequestPrompted": DeviceAccess.DeviceRequestPromptedEvent;
  "DOM.adoptedStyleSheetsModified": DOM.AdoptedStyleSheetsModifiedEvent;
  "DOM.adRelatedStateUpdated": DOM.AdRelatedStateUpdatedEvent;
  "DOM.affectedByStartingStylesFlagUpdated": DOM.AffectedByStartingStylesFlagUpdatedEvent;
  "DOM.attributeModified": DOM.AttributeModifiedEvent;
  "DOM.attributeRemoved": DOM.AttributeRemovedEvent;
  "DOM.characterDataModified": DOM.CharacterDataModifiedEvent;
  "DOM.childNodeCountUpdated": DOM.ChildNodeCountUpdatedEvent;
  "DOM.childNodeInserted": DOM.ChildNodeInsertedEvent;
  "DOM.childNodeRemoved": DOM.ChildNodeRemovedEvent;
  "DOM.distributedNodesUpdated": DOM.DistributedNodesUpdatedEvent;
  "DOM.documentUpdated": DOM.DocumentUpdatedEvent;
  "DOM.inlineStyleInvalidated": DOM.InlineStyleInvalidatedEvent;
  "DOM.pseudoElementAdded": DOM.PseudoElementAddedEvent;
  "DOM.pseudoElementRemoved": DOM.PseudoElementRemovedEvent;
  "DOM.scrollableFlagUpdated": DOM.ScrollableFlagUpdatedEvent;
  "DOM.setChildNodes": DOM.SetChildNodesEvent;
  "DOM.shadowRootPopped": DOM.ShadowRootPoppedEvent;
  "DOM.shadowRootPushed": DOM.ShadowRootPushedEvent;
  "DOM.topLayerElementsUpdated": DOM.TopLayerElementsUpdatedEvent;
  "DOMStorage.domStorageItemAdded": DOMStorage.DomStorageItemAddedEvent;
  "DOMStorage.domStorageItemRemoved": DOMStorage.DomStorageItemRemovedEvent;
  "DOMStorage.domStorageItemsCleared": DOMStorage.DomStorageItemsClearedEvent;
  "DOMStorage.domStorageItemUpdated": DOMStorage.DomStorageItemUpdatedEvent;
  "Emulation.screenOrientationLockChanged": Emulation.ScreenOrientationLockChangedEvent;
  "Emulation.virtualTimeBudgetExpired": Emulation.VirtualTimeBudgetExpiredEvent;
  "FedCm.dialogClosed": FedCm.DialogClosedEvent;
  "FedCm.dialogShown": FedCm.DialogShownEvent;
  "Fetch.authRequired": Fetch.AuthRequiredEvent;
  "Fetch.requestPaused": Fetch.RequestPausedEvent;
  "HeapProfiler.addHeapSnapshotChunk": HeapProfiler.AddHeapSnapshotChunkEvent;
  "HeapProfiler.heapStatsUpdate": HeapProfiler.HeapStatsUpdateEvent;
  "HeapProfiler.lastSeenObjectId": HeapProfiler.LastSeenObjectIdEvent;
  "HeapProfiler.reportHeapSnapshotProgress": HeapProfiler.ReportHeapSnapshotProgressEvent;
  "HeapProfiler.resetProfiles": HeapProfiler.ResetProfilesEvent;
  "Input.dragIntercepted": Input.DragInterceptedEvent;
  "Inspector.detached": Inspector.DetachedEvent;
  "Inspector.targetCrashed": Inspector.TargetCrashedEvent;
  "Inspector.targetReloadedAfterCrash": Inspector.TargetReloadedAfterCrashEvent;
  "Inspector.workerScriptLoaded": Inspector.WorkerScriptLoadedEvent;
  "LayerTree.layerPainted": LayerTree.LayerPaintedEvent;
  "LayerTree.layerTreeDidChange": LayerTree.LayerTreeDidChangeEvent;
  "Log.entryAdded": Log.EntryAddedEvent;
  "Media.playerCreated": Media.PlayerCreatedEvent;
  "Media.playerErrorsRaised": Media.PlayerErrorsRaisedEvent;
  "Media.playerEventsAdded": Media.PlayerEventsAddedEvent;
  "Media.playerMessagesLogged": Media.PlayerMessagesLoggedEvent;
  "Media.playerPropertiesChanged": Media.PlayerPropertiesChangedEvent;
  "Network.dataReceived": Network.DataReceivedEvent;
  "Network.deviceBoundSessionEventOccurred": Network.DeviceBoundSessionEventOccurredEvent;
  "Network.deviceBoundSessionsAdded": Network.DeviceBoundSessionsAddedEvent;
  "Network.directTCPSocketAborted": Network.DirectTCPSocketAbortedEvent;
  "Network.directTCPSocketChunkReceived": Network.DirectTCPSocketChunkReceivedEvent;
  "Network.directTCPSocketChunkSent": Network.DirectTCPSocketChunkSentEvent;
  "Network.directTCPSocketClosed": Network.DirectTCPSocketClosedEvent;
  "Network.directTCPSocketCreated": Network.DirectTCPSocketCreatedEvent;
  "Network.directTCPSocketOpened": Network.DirectTCPSocketOpenedEvent;
  "Network.directUDPSocketAborted": Network.DirectUDPSocketAbortedEvent;
  "Network.directUDPSocketChunkReceived": Network.DirectUDPSocketChunkReceivedEvent;
  "Network.directUDPSocketChunkSent": Network.DirectUDPSocketChunkSentEvent;
  "Network.directUDPSocketClosed": Network.DirectUDPSocketClosedEvent;
  "Network.directUDPSocketCreated": Network.DirectUDPSocketCreatedEvent;
  "Network.directUDPSocketJoinedMulticastGroup": Network.DirectUDPSocketJoinedMulticastGroupEvent;
  "Network.directUDPSocketLeftMulticastGroup": Network.DirectUDPSocketLeftMulticastGroupEvent;
  "Network.directUDPSocketOpened": Network.DirectUDPSocketOpenedEvent;
  "Network.eventSourceMessageReceived": Network.EventSourceMessageReceivedEvent;
  "Network.loadingFailed": Network.LoadingFailedEvent;
  "Network.loadingFinished": Network.LoadingFinishedEvent;
  "Network.policyUpdated": Network.PolicyUpdatedEvent;
  "Network.reportingApiEndpointsChangedForOrigin": Network.ReportingApiEndpointsChangedForOriginEvent;
  "Network.reportingApiReportAdded": Network.ReportingApiReportAddedEvent;
  "Network.reportingApiReportUpdated": Network.ReportingApiReportUpdatedEvent;
  "Network.requestIntercepted": Network.RequestInterceptedEvent;
  "Network.requestServedFromCache": Network.RequestServedFromCacheEvent;
  "Network.requestWillBeSent": Network.RequestWillBeSentEvent;
  "Network.requestWillBeSentExtraInfo": Network.RequestWillBeSentExtraInfoEvent;
  "Network.resourceChangedPriority": Network.ResourceChangedPriorityEvent;
  "Network.responseReceived": Network.ResponseReceivedEvent;
  "Network.responseReceivedEarlyHints": Network.ResponseReceivedEarlyHintsEvent;
  "Network.responseReceivedExtraInfo": Network.ResponseReceivedExtraInfoEvent;
  "Network.signedExchangeReceived": Network.SignedExchangeReceivedEvent;
  "Network.trustTokenOperationDone": Network.TrustTokenOperationDoneEvent;
  "Network.webSocketClosed": Network.WebSocketClosedEvent;
  "Network.webSocketCreated": Network.WebSocketCreatedEvent;
  "Network.webSocketFrameError": Network.WebSocketFrameErrorEvent;
  "Network.webSocketFrameReceived": Network.WebSocketFrameReceivedEvent;
  "Network.webSocketFrameSent": Network.WebSocketFrameSentEvent;
  "Network.webSocketHandshakeResponseReceived": Network.WebSocketHandshakeResponseReceivedEvent;
  "Network.webSocketWillSendHandshakeRequest": Network.WebSocketWillSendHandshakeRequestEvent;
  "Network.webTransportClosed": Network.WebTransportClosedEvent;
  "Network.webTransportConnectionEstablished": Network.WebTransportConnectionEstablishedEvent;
  "Network.webTransportCreated": Network.WebTransportCreatedEvent;
  "Overlay.inspectedElementWindowRestored": Overlay.InspectedElementWindowRestoredEvent;
  "Overlay.inspectModeCanceled": Overlay.InspectModeCanceledEvent;
  "Overlay.inspectNodeRequested": Overlay.InspectNodeRequestedEvent;
  "Overlay.inspectPanelShowRequested": Overlay.InspectPanelShowRequestedEvent;
  "Overlay.nodeHighlightRequested": Overlay.NodeHighlightRequestedEvent;
  "Overlay.screenshotRequested": Overlay.ScreenshotRequestedEvent;
  "Page.backForwardCacheNotUsed": Page.BackForwardCacheNotUsedEvent;
  "Page.compilationCacheProduced": Page.CompilationCacheProducedEvent;
  "Page.documentOpened": Page.DocumentOpenedEvent;
  "Page.domContentEventFired": Page.DomContentEventFiredEvent;
  "Page.downloadProgress": Page.DownloadProgressEvent;
  "Page.downloadWillBegin": Page.DownloadWillBeginEvent;
  "Page.fileChooserOpened": Page.FileChooserOpenedEvent;
  "Page.frameAttached": Page.FrameAttachedEvent;
  "Page.frameClearedScheduledNavigation": Page.FrameClearedScheduledNavigationEvent;
  "Page.frameDetached": Page.FrameDetachedEvent;
  "Page.frameNavigated": Page.FrameNavigatedEvent;
  "Page.frameRequestedNavigation": Page.FrameRequestedNavigationEvent;
  "Page.frameResized": Page.FrameResizedEvent;
  "Page.frameScheduledNavigation": Page.FrameScheduledNavigationEvent;
  "Page.frameStartedLoading": Page.FrameStartedLoadingEvent;
  "Page.frameStartedNavigating": Page.FrameStartedNavigatingEvent;
  "Page.frameStoppedLoading": Page.FrameStoppedLoadingEvent;
  "Page.frameSubtreeWillBeDetached": Page.FrameSubtreeWillBeDetachedEvent;
  "Page.interstitialHidden": Page.InterstitialHiddenEvent;
  "Page.interstitialShown": Page.InterstitialShownEvent;
  "Page.javascriptDialogClosed": Page.JavascriptDialogClosedEvent;
  "Page.javascriptDialogOpening": Page.JavascriptDialogOpeningEvent;
  "Page.lifecycleEvent": Page.LifecycleEventEvent;
  "Page.loadEventFired": Page.LoadEventFiredEvent;
  "Page.navigatedWithinDocument": Page.NavigatedWithinDocumentEvent;
  "Page.screencastFrame": Page.ScreencastFrameEvent;
  "Page.screencastVisibilityChanged": Page.ScreencastVisibilityChangedEvent;
  "Page.windowOpen": Page.WindowOpenEvent;
  "Performance.metrics": Performance.MetricsEvent;
  "PerformanceTimeline.timelineEventAdded": PerformanceTimeline.TimelineEventAddedEvent;
  "Preload.prefetchStatusUpdated": Preload.PrefetchStatusUpdatedEvent;
  "Preload.preloadEnabledStateUpdated": Preload.PreloadEnabledStateUpdatedEvent;
  "Preload.preloadingAttemptSourcesUpdated": Preload.PreloadingAttemptSourcesUpdatedEvent;
  "Preload.prerenderStatusUpdated": Preload.PrerenderStatusUpdatedEvent;
  "Preload.ruleSetRemoved": Preload.RuleSetRemovedEvent;
  "Preload.ruleSetUpdated": Preload.RuleSetUpdatedEvent;
  "Profiler.consoleProfileFinished": Profiler.ConsoleProfileFinishedEvent;
  "Profiler.consoleProfileStarted": Profiler.ConsoleProfileStartedEvent;
  "Profiler.preciseCoverageDeltaUpdate": Profiler.PreciseCoverageDeltaUpdateEvent;
  "Runtime.bindingCalled": Runtime.BindingCalledEvent;
  "Runtime.consoleAPICalled": Runtime.ConsoleAPICalledEvent;
  "Runtime.exceptionRevoked": Runtime.ExceptionRevokedEvent;
  "Runtime.exceptionThrown": Runtime.ExceptionThrownEvent;
  "Runtime.executionContextCreated": Runtime.ExecutionContextCreatedEvent;
  "Runtime.executionContextDestroyed": Runtime.ExecutionContextDestroyedEvent;
  "Runtime.executionContextsCleared": Runtime.ExecutionContextsClearedEvent;
  "Runtime.inspectRequested": Runtime.InspectRequestedEvent;
  "Security.certificateError": Security.CertificateErrorEvent;
  "Security.securityStateChanged": Security.SecurityStateChangedEvent;
  "Security.visibleSecurityStateChanged": Security.VisibleSecurityStateChangedEvent;
  "ServiceWorker.workerErrorReported": ServiceWorker.WorkerErrorReportedEvent;
  "ServiceWorker.workerRegistrationUpdated": ServiceWorker.WorkerRegistrationUpdatedEvent;
  "ServiceWorker.workerVersionUpdated": ServiceWorker.WorkerVersionUpdatedEvent;
  "SmartCardEmulation.beginTransactionRequested": SmartCardEmulation.BeginTransactionRequestedEvent;
  "SmartCardEmulation.cancelRequested": SmartCardEmulation.CancelRequestedEvent;
  "SmartCardEmulation.connectRequested": SmartCardEmulation.ConnectRequestedEvent;
  "SmartCardEmulation.controlRequested": SmartCardEmulation.ControlRequestedEvent;
  "SmartCardEmulation.disconnectRequested": SmartCardEmulation.DisconnectRequestedEvent;
  "SmartCardEmulation.endTransactionRequested": SmartCardEmulation.EndTransactionRequestedEvent;
  "SmartCardEmulation.establishContextRequested": SmartCardEmulation.EstablishContextRequestedEvent;
  "SmartCardEmulation.getAttribRequested": SmartCardEmulation.GetAttribRequestedEvent;
  "SmartCardEmulation.getStatusChangeRequested": SmartCardEmulation.GetStatusChangeRequestedEvent;
  "SmartCardEmulation.listReadersRequested": SmartCardEmulation.ListReadersRequestedEvent;
  "SmartCardEmulation.releaseContextRequested": SmartCardEmulation.ReleaseContextRequestedEvent;
  "SmartCardEmulation.setAttribRequested": SmartCardEmulation.SetAttribRequestedEvent;
  "SmartCardEmulation.statusRequested": SmartCardEmulation.StatusRequestedEvent;
  "SmartCardEmulation.transmitRequested": SmartCardEmulation.TransmitRequestedEvent;
  "Storage.cacheStorageContentUpdated": Storage.CacheStorageContentUpdatedEvent;
  "Storage.cacheStorageListUpdated": Storage.CacheStorageListUpdatedEvent;
  "Storage.indexedDBContentUpdated": Storage.IndexedDBContentUpdatedEvent;
  "Storage.indexedDBListUpdated": Storage.IndexedDBListUpdatedEvent;
  "Storage.interestGroupAccessed": Storage.InterestGroupAccessedEvent;
  "Storage.interestGroupAuctionEventOccurred": Storage.InterestGroupAuctionEventOccurredEvent;
  "Storage.interestGroupAuctionNetworkRequestCreated": Storage.InterestGroupAuctionNetworkRequestCreatedEvent;
  "Storage.sharedStorageAccessed": Storage.SharedStorageAccessedEvent;
  "Storage.sharedStorageWorkletOperationExecutionFinished": Storage.SharedStorageWorkletOperationExecutionFinishedEvent;
  "Storage.storageBucketCreatedOrUpdated": Storage.StorageBucketCreatedOrUpdatedEvent;
  "Storage.storageBucketDeleted": Storage.StorageBucketDeletedEvent;
  "Target.attachedToTarget": Target.AttachedToTargetEvent;
  "Target.detachedFromTarget": Target.DetachedFromTargetEvent;
  "Target.receivedMessageFromTarget": Target.ReceivedMessageFromTargetEvent;
  "Target.targetCrashed": Target.TargetCrashedEvent;
  "Target.targetCreated": Target.TargetCreatedEvent;
  "Target.targetDestroyed": Target.TargetDestroyedEvent;
  "Target.targetInfoChanged": Target.TargetInfoChangedEvent;
  "Tethering.accepted": Tethering.AcceptedEvent;
  "Tracing.bufferUsage": Tracing.BufferUsageEvent;
  "Tracing.dataCollected": Tracing.DataCollectedEvent;
  "Tracing.tracingComplete": Tracing.TracingCompleteEvent;
  "WebAudio.audioListenerCreated": WebAudio.AudioListenerCreatedEvent;
  "WebAudio.audioListenerWillBeDestroyed": WebAudio.AudioListenerWillBeDestroyedEvent;
  "WebAudio.audioNodeCreated": WebAudio.AudioNodeCreatedEvent;
  "WebAudio.audioNodeWillBeDestroyed": WebAudio.AudioNodeWillBeDestroyedEvent;
  "WebAudio.audioParamCreated": WebAudio.AudioParamCreatedEvent;
  "WebAudio.audioParamWillBeDestroyed": WebAudio.AudioParamWillBeDestroyedEvent;
  "WebAudio.contextChanged": WebAudio.ContextChangedEvent;
  "WebAudio.contextCreated": WebAudio.ContextCreatedEvent;
  "WebAudio.contextWillBeDestroyed": WebAudio.ContextWillBeDestroyedEvent;
  "WebAudio.nodeParamConnected": WebAudio.NodeParamConnectedEvent;
  "WebAudio.nodeParamDisconnected": WebAudio.NodeParamDisconnectedEvent;
  "WebAudio.nodesConnected": WebAudio.NodesConnectedEvent;
  "WebAudio.nodesDisconnected": WebAudio.NodesDisconnectedEvent;
  "WebAuthn.credentialAdded": WebAuthn.CredentialAddedEvent;
  "WebAuthn.credentialAsserted": WebAuthn.CredentialAssertedEvent;
  "WebAuthn.credentialDeleted": WebAuthn.CredentialDeletedEvent;
  "WebAuthn.credentialUpdated": WebAuthn.CredentialUpdatedEvent;
  "WebMCP.toolInvoked": WebMCP.ToolInvokedEvent;
  "WebMCP.toolResponded": WebMCP.ToolRespondedEvent;
  "WebMCP.toolsAdded": WebMCP.ToolsAddedEvent;
  "WebMCP.toolsRemoved": WebMCP.ToolsRemovedEvent;
}

export type CdpMethodName = keyof CdpCommands;
export type CdpMethodParams<M extends CdpMethodName> = CdpCommands[M]['params'];
export type CdpMethodResult<M extends CdpMethodName> = CdpCommands[M]['result'];

export type CdpEventName = keyof CdpEvents;
export type CdpEventPayload<E extends CdpEventName> = CdpEvents[E];
