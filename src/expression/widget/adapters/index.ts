// Public surface for `src/expression/widget/adapters/`. Pure mapping
// helpers between domain-specific request shapes (ACP ask-user-question
// + HITL confirm) and the generic `InteractiveModalSpec` the widget
// runtime drives. Hosts that want to route a domain prompt through the
// expression substrate import the appropriate pair of helpers and feed
// them through `runInteractiveModalSession`.

export {
  askUserRequestToInteractiveModalSpec,
  interactiveModalResultToAnswer,
  OTHER_LABEL,
  OTHER_TEXT_FIELD_SUFFIX,
  type AskUserAdapterOpts,
} from './ask-user.js';

export {
  hitlConfirmRequestToInteractiveModalSpec,
  interactiveModalResultToHitlConfirm,
  type HitlConfirmAdapterOpts,
} from './hitl-confirm.js';

export {
  createWidgetAskUserResolver,
  type CreateWidgetAskUserResolverOpts,
} from './ask-user-resolver.js';

export {
  createWidgetHitlChannel,
  type CreateWidgetHitlChannelOpts,
} from './hitl-channel.js';
