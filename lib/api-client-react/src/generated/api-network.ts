/**
 * Network module: cancel friend request, network stats, patient referrals,
 * and specialist consultations.
 */
import {
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  QueryFunction,
  MutationFunction,
  QueryKey,
} from "@tanstack/react-query";

import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
import type {
  NetworkStats,
  PatientReferralItem,
  ReferralsListResponse,
  CreateReferralInput,
  DoctorConsultationItem,
  ConsultationsListResponse,
  CreateConsultationInput,
  UpdateConsultationInput,
} from "./api.schemas";

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  return Object.assign(query, { queryKey });
};

// ─── Cancel Friend Request ────────────────────────────────────────────────────

export const getCancelFriendRequestUrl = (id: number) => `/api/friends/${id}/cancel`;

export const cancelFriendRequest = async (id: number, options?: RequestInit): Promise<void> => {
  return customFetch<void>(getCancelFriendRequestUrl(id), { ...options, method: "DELETE" });
};

export const getCancelFriendRequestMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof cancelFriendRequest>>,
      TError,
      { id: number },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof cancelFriendRequest>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationKey = ["cancelFriendRequest"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof cancelFriendRequest>>,
    { id: number }
  > = (props) => {
    const { id } = props ?? {};
    return cancelFriendRequest(id, requestOptions);
  };
  return { mutationFn, ...mutationOptions };
};

export type CancelFriendRequestMutationResult = NonNullable<
  Awaited<ReturnType<typeof cancelFriendRequest>>
>;
export type CancelFriendRequestMutationError = ErrorType<unknown>;

export const useCancelFriendRequest = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof cancelFriendRequest>>,
      TError,
      { id: number },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof cancelFriendRequest>>,
  TError,
  { id: number },
  TContext
> => {
  return useMutation(getCancelFriendRequestMutationOptions(options));
};

// ─── Network Stats ─────────────────────────────────────────────────────────────

export const getNetworkStatsUrl = () => `/api/network/stats`;

export const getNetworkStats = async (options?: RequestInit): Promise<NetworkStats> => {
  return customFetch<NetworkStats>(getNetworkStatsUrl(), { ...options, method: "GET" });
};

export const getNetworkStatsQueryKey = () => ["/api/network/stats"] as const;

export const getNetworkStatsQueryOptions = <
  TData = Awaited<ReturnType<typeof getNetworkStats>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNetworkStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getNetworkStatsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getNetworkStats>>> = ({ signal }) =>
    getNetworkStats({ signal, ...requestOptions });
  return {
    queryKey,
    queryFn,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof getNetworkStats>>, TError, TData> & {
    queryKey: QueryKey;
  };
};

export type GetNetworkStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getNetworkStats>>>;
export type GetNetworkStatsQueryError = ErrorType<unknown>;

export function useGetNetworkStats<
  TData = Awaited<ReturnType<typeof getNetworkStats>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNetworkStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getNetworkStatsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ─── Patient Referrals ────────────────────────────────────────────────────────

export const getListReferralsUrl = () => `/api/referrals`;

export const listReferrals = async (options?: RequestInit): Promise<ReferralsListResponse> => {
  return customFetch<ReferralsListResponse>(getListReferralsUrl(), { ...options, method: "GET" });
};

export const getListReferralsQueryKey = () => ["/api/referrals"] as const;

export const getListReferralsQueryOptions = <
  TData = Awaited<ReturnType<typeof listReferrals>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReferrals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListReferralsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listReferrals>>> = ({ signal }) =>
    listReferrals({ signal, ...requestOptions });
  return {
    queryKey,
    queryFn,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof listReferrals>>, TError, TData> & {
    queryKey: QueryKey;
  };
};

export type ListReferralsQueryResult = NonNullable<Awaited<ReturnType<typeof listReferrals>>>;
export type ListReferralsQueryError = ErrorType<unknown>;

export function useListReferrals<
  TData = Awaited<ReturnType<typeof listReferrals>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReferrals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListReferralsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

export const createReferral = async (
  data: BodyType<CreateReferralInput>,
  options?: RequestInit,
): Promise<PatientReferralItem> => {
  return customFetch<PatientReferralItem>("/api/referrals", {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getCreateReferralMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof createReferral>>,
      TError,
      { data: BodyType<CreateReferralInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof createReferral>>,
  TError,
  { data: BodyType<CreateReferralInput> },
  TContext
> => {
  const mutationKey = ["createReferral"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createReferral>>,
    { data: BodyType<CreateReferralInput> }
  > = (props) => {
    const { data } = props ?? {};
    return createReferral(data, requestOptions);
  };
  return { mutationFn, ...mutationOptions };
};

export type CreateReferralMutationResult = NonNullable<Awaited<ReturnType<typeof createReferral>>>;
export type CreateReferralMutationError = ErrorType<unknown>;

export const useCreateReferral = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof createReferral>>,
      TError,
      { data: BodyType<CreateReferralInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof createReferral>>,
  TError,
  { data: BodyType<CreateReferralInput> },
  TContext
> => {
  return useMutation(getCreateReferralMutationOptions(options));
};

export const updateReferralStatus = async (
  id: number,
  data: { status: string },
  options?: RequestInit,
): Promise<PatientReferralItem> => {
  return customFetch<PatientReferralItem>(`/api/referrals/${id}/status`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

export const getUpdateReferralStatusMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof updateReferralStatus>>,
      TError,
      { id: number; data: { status: string } },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof updateReferralStatus>>,
  TError,
  { id: number; data: { status: string } },
  TContext
> => {
  const mutationKey = ["updateReferralStatus"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateReferralStatus>>,
    { id: number; data: { status: string } }
  > = (props) => {
    const { id, data } = props ?? {};
    return updateReferralStatus(id, data, requestOptions);
  };
  return { mutationFn, ...mutationOptions };
};

export type UpdateReferralStatusMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateReferralStatus>>
>;
export type UpdateReferralStatusMutationError = ErrorType<unknown>;

export const useUpdateReferralStatus = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof updateReferralStatus>>,
      TError,
      { id: number; data: { status: string } },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof updateReferralStatus>>,
  TError,
  { id: number; data: { status: string } },
  TContext
> => {
  return useMutation(getUpdateReferralStatusMutationOptions(options));
};

// ─── Specialist Consultations ─────────────────────────────────────────────────

export const getListConsultationsUrl = () => `/api/consultations`;

export const listConsultations = async (
  options?: RequestInit,
): Promise<ConsultationsListResponse> => {
  return customFetch<ConsultationsListResponse>(getListConsultationsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getListConsultationsQueryKey = () => ["/api/consultations"] as const;

export const getListConsultationsQueryOptions = <
  TData = Awaited<ReturnType<typeof listConsultations>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConsultations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListConsultationsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listConsultations>>> = ({ signal }) =>
    listConsultations({ signal, ...requestOptions });
  return {
    queryKey,
    queryFn,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof listConsultations>>, TError, TData> & {
    queryKey: QueryKey;
  };
};

export type ListConsultationsQueryResult = NonNullable<
  Awaited<ReturnType<typeof listConsultations>>
>;
export type ListConsultationsQueryError = ErrorType<unknown>;

export function useListConsultations<
  TData = Awaited<ReturnType<typeof listConsultations>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConsultations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListConsultationsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

export const createConsultation = async (
  data: BodyType<CreateConsultationInput>,
  options?: RequestInit,
): Promise<DoctorConsultationItem> => {
  return customFetch<DoctorConsultationItem>("/api/consultations", {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getCreateConsultationMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof createConsultation>>,
      TError,
      { data: BodyType<CreateConsultationInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof createConsultation>>,
  TError,
  { data: BodyType<CreateConsultationInput> },
  TContext
> => {
  const mutationKey = ["createConsultation"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createConsultation>>,
    { data: BodyType<CreateConsultationInput> }
  > = (props) => {
    const { data } = props ?? {};
    return createConsultation(data, requestOptions);
  };
  return { mutationFn, ...mutationOptions };
};

export type CreateConsultationMutationResult = NonNullable<
  Awaited<ReturnType<typeof createConsultation>>
>;
export type CreateConsultationMutationError = ErrorType<unknown>;

export const useCreateConsultation = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof createConsultation>>,
      TError,
      { data: BodyType<CreateConsultationInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof createConsultation>>,
  TError,
  { data: BodyType<CreateConsultationInput> },
  TContext
> => {
  return useMutation(getCreateConsultationMutationOptions(options));
};

export const updateConsultation = async (
  id: number,
  data: BodyType<UpdateConsultationInput>,
  options?: RequestInit,
): Promise<DoctorConsultationItem> => {
  return customFetch<DoctorConsultationItem>(`/api/consultations/${id}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

export const getUpdateConsultationMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof updateConsultation>>,
      TError,
      { id: number; data: BodyType<UpdateConsultationInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof updateConsultation>>,
  TError,
  { id: number; data: BodyType<UpdateConsultationInput> },
  TContext
> => {
  const mutationKey = ["updateConsultation"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateConsultation>>,
    { id: number; data: BodyType<UpdateConsultationInput> }
  > = (props) => {
    const { id, data } = props ?? {};
    return updateConsultation(id, data, requestOptions);
  };
  return { mutationFn, ...mutationOptions };
};

export type UpdateConsultationMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateConsultation>>
>;
export type UpdateConsultationMutationError = ErrorType<unknown>;

export const useUpdateConsultation = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof updateConsultation>>,
      TError,
      { id: number; data: BodyType<UpdateConsultationInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof updateConsultation>>,
  TError,
  { id: number; data: BodyType<UpdateConsultationInput> },
  TContext
> => {
  return useMutation(getUpdateConsultationMutationOptions(options));
};
