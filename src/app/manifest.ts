import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'NextMav Business Operating System', short_name: 'NextMav', start_url: '/dashboard', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff', icons: [192, 512].map(size => ({ src: `/icons/nextmav-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })) };
}
