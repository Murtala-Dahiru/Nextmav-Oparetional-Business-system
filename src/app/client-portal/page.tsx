import type {Metadata} from 'next';
import {ClientPortal} from '@/components/sign/client-portal';
export const metadata:Metadata={title:'NextMav Client Portal',robots:{index:false,follow:false},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default function Page(){return <ClientPortal/>;}
