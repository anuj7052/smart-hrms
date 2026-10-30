import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) return (
    <div className="text-center space-y-4">
      <p className="text-gray-700">If that email exists, a password reset link has been sent. Check your inbox.</p>
      <Link to="/login" className="text-primary-600 hover:underline text-sm">Back to login</Link>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Forgot password</h2>
        <p className="text-sm text-gray-500 mt-1">Enter your email to receive a reset link.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Send reset link
      </button>
      <p className="text-center">
        <Link to="/login" className="text-sm text-primary-600 hover:underline">Back to login</Link>
      </p>
    </form>
  );
}
