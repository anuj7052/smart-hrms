import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import api from '../services/api';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No verification token found.'); return; }
    api.post('/auth/verify-email', { token })
      .then((res: { data: { message: string } }) => { setStatus('success'); setMessage(res.data.message); })
      .catch((err: { response?: { data?: { message?: string } } }) => { setStatus('error'); setMessage(err.response?.data?.message || 'Verification failed'); });
  }, [token]);

  return (
    <div className="text-center space-y-4">
      {status === 'loading' && <Loader2 className="w-10 h-10 animate-spin text-primary-600 mx-auto" />}
      {status === 'success' && <CheckCircle className="w-12 h-12 text-secondary-500 mx-auto" />}
      {status === 'error' && <XCircle className="w-12 h-12 text-red-500 mx-auto" />}
      <p className="text-gray-700">{message || 'Verifying...'}</p>
      {status !== 'loading' && (
        <Link to="/login" className="btn-primary inline-block">Go to Login</Link>
      )}
    </div>
  );
}
