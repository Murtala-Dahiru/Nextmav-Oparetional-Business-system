import Link from 'next/link';
import { Hexagon, SearchX, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="text-center space-y-6 max-w-lg">
        <div className="flex justify-center">
          <div className="relative">
            <span className="text-[10rem] sm:text-[12rem] font-black leading-none text-gray-200 dark:text-gray-800 select-none">
              404
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-emerald-500/10 p-4">
                <SearchX className="size-10 sm:size-12 text-emerald-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Page not found</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            The page you are looking for doesn&apos;t exist or has been moved. Let&apos;s get you
            back on track.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white h-11 px-6">
              <Home className="size-4" />
              Go to Dashboard
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="h-11 px-6">
              <Hexagon className="size-4 text-emerald-500" />
              Sign in
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}