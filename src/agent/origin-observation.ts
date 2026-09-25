/** Origin env를 관측 payload 계약으로 옮긴다. origin 판정과 설정은 진입점 소유다. */
interface OriginObservationFields {
  originRoot?: string;
  originAgent?: string;
  originSession?: string;
  controller?: string;
}

function presentEnv(name: 'MONAD_ORIGIN_ROOT' | 'MONAD_ORIGIN_AGENT' | 'MONAD_ORIGIN_SESSION' | 'MONAD_CONTROLLER'): string | undefined {
  const value = process.env[name];
  return value?.trim() ? value : undefined;
}

/** 이미 설정된 실행 origin을 추측 없이 관측 이벤트에 싣는다. */
export function originObservationFields(): OriginObservationFields {
  const originRoot = presentEnv('MONAD_ORIGIN_ROOT');
  const originAgent = presentEnv('MONAD_ORIGIN_AGENT');
  const originSession = presentEnv('MONAD_ORIGIN_SESSION');
  const controller = presentEnv('MONAD_CONTROLLER');
  return {
    ...(originRoot === undefined ? {} : { originRoot }),
    ...(originAgent === undefined ? {} : { originAgent }),
    ...(originSession === undefined ? {} : { originSession }),
    ...(controller === undefined ? {} : { controller }),
  };
}
