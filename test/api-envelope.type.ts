/** Shape of the ResponseInterceptor envelope, for typing supertest's untyped response.body in tests. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}
