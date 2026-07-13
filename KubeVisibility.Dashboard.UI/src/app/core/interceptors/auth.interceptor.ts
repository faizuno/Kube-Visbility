import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  
  // Get token from AuthService
  const token = authService.getAccessToken();
  
  // Check if we should exclude credentials to trigger OAuth2 proxy
  // This prevents HTTP-only cookies from being sent with the request
  const shouldExcludeCredentials = authService.shouldExcludeCredentialsFromRequest() || !token;
  
  // Build request options
  const requestOptions: { setHeaders?: Record<string, string>; withCredentials?: boolean } = {};
  
  // Add Authorization header if token exists
  if (token && !req.headers.has('Authorization')) {
    requestOptions.setHeaders = {
      Authorization: `Bearer ${token}`,
    };
  }
  
  // Exclude credentials (cookies) from request if needed to trigger OAuth2 proxy
  if (shouldExcludeCredentials) {
    requestOptions.withCredentials = false;
  }
  
  // Clone request with appropriate configuration
  const clonedReq = Object.keys(requestOptions).length > 0 
    ? req.clone(requestOptions)
    : req;
  
  return next(clonedReq).pipe(
    catchError((error) => {
      // Check if this is a 401 Unauthorized or 302 Redirect error
      // OAuth2 proxy returns 302 redirect when authentication fails
      if (error.status === 401 || error.status === 302) {
        // Clear auth state and set flag to exclude credentials from future requests
        authService.handleAuthError();
        
        // Perform hard reload to trigger OAuth2 proxy re-authentication
        // Use setTimeout to allow error to propagate first
        setTimeout(() => {
          window.location.reload();
        }, 100);
      }
      
      // Re-throw the error so it can be handled by the calling code
      return throwError(() => error);
    })
  );
};

