import type { GetServerSideProps } from 'next'

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/dashboard#pipeline',
    permanent: false,
  },
})

export default function IngestRedirect() {
  return null
}
